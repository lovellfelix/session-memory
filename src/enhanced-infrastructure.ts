import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { logger } from "./logger.js";
import { performanceTracker } from "./performance.js";
import { resolveEncryptionKeyPath } from "./runtime-paths.js";

/**
 * Encryption utilities for sensitive session data
 */
export class EncryptionManager {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly SALT_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly TAG_LENGTH = 16;

  private masterKey: Buffer | null = null;

  /**
   * Initialize encryption with secure key derivation
   * 
   * Security: Uses environment variable or generates/reads a random key file.
   * The key file is stored with restricted permissions (0600).
   */
  initialize(): void {
    let keySource: string | undefined = process.env.SESSION_ENCRYPTION_KEY;
    
    if (!keySource) {
      // Generate or read a secure random key from file
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs');
      const { dirname } = require('path');
      
      const keyPath = resolveEncryptionKeyPath();
      const keyDir = dirname(keyPath);
      
      if (existsSync(keyPath)) {
        // Read existing key
        keySource = readFileSync(keyPath, 'utf8').trim();
      } else {
        // Generate new random key (32 bytes = 256 bits, hex encoded = 64 chars)
        const randomKey = randomBytes(32).toString('hex');
        
        // Create directory with restricted permissions
        mkdirSync(keyDir, { recursive: true, mode: 0o700 });
        
        // Write key file with restricted permissions (owner read/write only)
        writeFileSync(keyPath, randomKey, { mode: 0o600 });
        keySource = randomKey;
        
        logger.info('Generated new encryption key', { keyPath });
      }
    }
    
    if (!keySource) {
      throw new Error('Failed to initialize encryption key');
    }
    
    this.masterKey = createHash('sha256')
      .update(keySource)
      .digest();
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(data: string): string {
    if (!this.masterKey) {
      throw new Error('Encryption manager not initialized');
    }

    const iv = randomBytes(EncryptionManager.IV_LENGTH);
    const cipher = createCipheriv(EncryptionManager.ALGORITHM, this.masterKey, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Combine IV + tag + encrypted data
    return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedData: string): string {
    if (!this.masterKey) {
      throw new Error('Encryption manager not initialized');
    }

    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = createDecipheriv(EncryptionManager.ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Check if data appears to be encrypted
   */
  isEncrypted(data: string): boolean {
    const parts = data.split(':');
    return parts.length === 3 && 
           parts[0].length === EncryptionManager.IV_LENGTH * 2 &&
           parts[1].length === EncryptionManager.TAG_LENGTH * 2;
  }
}

/**
 * Multi-level caching system
 */
export class CacheManager {
  private l1Cache = new Map<string, { data: any; expiry: number }>();
  private l2Cache?: Map<string, { data: any; expiry: number }>; // Redis in future
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get value from cache (L1 -> L2 -> miss)
   */
  async get(key: string): Promise<any> {
    // L1 cache check
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry && Date.now() < l1Entry.expiry) {
      return l1Entry.data;
    }
    if (l1Entry) {
      this.l1Cache.delete(key);
    }

    // L2 cache check (future Redis implementation)
    if (this.l2Cache) {
      const l2Entry = this.l2Cache.get(key);
      if (l2Entry && Date.now() < l2Entry.expiry) {
        // Promote to L1
        this.l1Cache.set(key, l2Entry);
        return l2Entry.data;
      }
      if (l2Entry) {
        this.l2Cache.delete(key);
      }
    }

    return null;
  }

  /**
   * Set value in cache
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const expiry = Date.now() + (ttl || this.defaultTTL);
    
    // Store in L1
    this.l1Cache.set(key, { data: value, expiry });
    
    // Store in L2 if available
    if (this.l2Cache) {
      this.l2Cache.set(key, { data: value, expiry });
    }
  }

  /**
   * Delete from cache
   */
  async delete(key: string): Promise<void> {
    this.l1Cache.delete(key);
    if (this.l2Cache) {
      this.l2Cache.delete(key);
    }
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    this.l1Cache.clear();
    if (this.l2Cache) {
      this.l2Cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { l1Size: number; l2Size: number; hitRate: number } {
    return {
      l1Size: this.l1Cache.size,
      l2Size: this.l2Cache?.size || 0,
      hitRate: 0 // TODO: Implement hit rate tracking
    };
  }
}

/**
 * Advanced connection pool for better concurrency
 * 
 * Implementation notes:
 * - Uses better-sqlite3 when available (fast, file-backed, safe for multi-connection reads).
 * - If better-sqlite3 is not installed/available, acquire() throws with a clear error.
 */
export class ConnectionPool {
  private pool: any[] = []; // Runtime-agnostic database type
  private readonly maxConnections: number;
  private readonly minConnections: number;
  private readonly dbPath: string;
  private readonly options: any;
  private waitingQueue: Array<{
    resolve: (db: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private activeConnections = 0;

  private driverCtor: any | null = null;
  private driverLoadPromise: Promise<void> | null = null;

  constructor(
    dbPath: string, 
    options: any = {},
    { maxConnections = 10, minConnections = 2 } = {}
  ) {
    this.dbPath = dbPath;
    this.options = options;
    this.maxConnections = maxConnections;
    this.minConnections = minConnections;

    // Bun doesn't support better-sqlite3 reliably; callers should prefer MCP tools.
    if ((process as any).versions?.bun) {
      logger.warn('ConnectionPool running under Bun; better-sqlite3 may be unavailable');
    }
  }

  /**
   * Initialize minimum connections
   */
  private initializePool(): void {
    // Lazy init in acquire()
  }

  /**
   * Create new database connection with optimizations
   */
  private createConnection(): any {
    if (!this.driverCtor) {
      throw new Error('better-sqlite3 driver not loaded');
    }
    const db = new this.driverCtor(this.dbPath, this.options);
    return db;
  }

  /**
   * Acquire connection from pool
   */
  async acquire(): Promise<any> {
    const endTimer = performanceTracker.start('pool:acquire');
    await this.ensureDriverLoaded();

    // Fast path: reuse an idle connection.
    const existing = this.pool.pop();
    if (existing) {
      this.activeConnections++;
      endTimer();
      return existing;
    }

    // Create a new connection if under max.
    if (this.activeConnections < this.maxConnections) {
      const db = this.createConnection();
      this.activeConnections++;
      endTimer();
      return db;
    }

    // Wait for a connection to be released.
    endTimer();
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for database connection'));
      }, 5000);

      this.waitingQueue.push({ resolve, reject, timeout });
    });
  }

  /**
   * Release connection back to pool
   */
  release(db: any): void {
    // Hand a waiting caller a connection if possible.
    const waiter = this.waitingQueue.shift();
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve(db);
      return;
    }

    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.pool.push(db);
  }

  /**
   * Health check for connections
   */
  private startHealthCheck(): void {
    // Disabled for Bun compatibility
  }

  /**
   * Close all connections
   */
  close(): void {
    this.waitingQueue.forEach(waiter => {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Pool closing'));
    });
    this.waitingQueue = [];

    [...this.pool].forEach(db => db.close());
    this.pool = [];
  }

  private async ensureDriverLoaded(): Promise<void> {
    if (this.driverCtor) return;

    if (!this.driverLoadPromise) {
      this.driverLoadPromise = (async () => {
        try {
          const driverModule = 'better-sqlite3';
          const mod: any = await import(driverModule);
          this.driverCtor = mod?.default ?? mod;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `better-sqlite3 is required for ConnectionPool in this runtime (failed to load: ${message})`
          );
        }
      })();
    }

    await this.driverLoadPromise;
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalConnections: number;
    availableConnections: number;
    activeConnections: number;
    waitingQueue: number;
  } {
    return {
      totalConnections: this.pool.length + this.activeConnections,
      availableConnections: this.pool.length,
      activeConnections: this.activeConnections,
      waitingQueue: this.waitingQueue.length
    };
  }
}

/**
 * Performance monitoring and metrics collection
 */
export class MetricsCollector {
  private metrics = new Map<string, {
    count: number;
    totalTime: number;
    errors: number;
    minTime: number;
    maxTime: number;
  }>();

  /**
   * Record operation metrics
   */
  record(
    operation: string, 
    duration: number, 
    success: boolean = true
  ): void {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, {
        count: 0,
        totalTime: 0,
        errors: 0,
        minTime: Infinity,
        maxTime: 0
      });
    }

    const metric = this.metrics.get(operation)!;
    metric.count++;
    metric.totalTime += duration;
    if (!success) metric.errors++;
    metric.minTime = Math.min(metric.minTime, duration);
    metric.maxTime = Math.max(metric.maxTime, duration);
  }

  /**
   * Get metrics for all operations
   */
  getMetrics(): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const [operation, metric] of this.metrics.entries()) {
      result[operation] = {
        count: metric.count,
        avgTime: metric.totalTime / metric.count,
        minTime: metric.minTime === Infinity ? 0 : metric.minTime,
        maxTime: metric.maxTime,
        errors: metric.errors,
        errorRate: metric.errors / metric.count,
        totalTime: metric.totalTime
      };
    }
    
    return result;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
  }
}

/**
 * Enhanced batch processor for bulk operations
 */
export class BatchProcessor {
  private readonly batchSize: number;
  private readonly timeout: number;
  private pendingItems: any[] = [];
  private timer?: NodeJS.Timeout;
  private readonly processFn: (items: any[]) => Promise<void>;

  constructor(
    processFn: (items: any[]) => Promise<void>,
    { batchSize = 100, timeout = 1000 } = {}
  ) {
    this.processFn = processFn;
    this.batchSize = batchSize;
    this.timeout = timeout;
  }

  /**
   * Add item to batch
   */
  async add(item: any): Promise<void> {
    this.pendingItems.push(item);

    if (this.pendingItems.length >= this.batchSize) {
      await this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.timeout);
    }
  }

  /**
   * Process all pending items
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.pendingItems.length === 0) {
      return;
    }

    const items = [...this.pendingItems];
    this.pendingItems = [];

    try {
      await this.processFn(items);
    } catch (error) {
      logger.error('Batch processing failed', error as Error, { itemCount: items.length });
      throw error;
    }
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.pendingItems.length;
  }
}

// Singleton instances
export const encryptionManager = new EncryptionManager();
export const cacheManager = new CacheManager();
export const metricsCollector = new MetricsCollector();

// Initialize encryption on import
encryptionManager.initialize();
