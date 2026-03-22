import { 
  SessionContext, 
  UserPreference, 
  ProjectConvention, 
  Interaction 
} from "./database.js";
import { 
  encryptionManager, 
  cacheManager, 
  ConnectionPool, 
  metricsCollector,
  BatchProcessor
} from "./enhanced-infrastructure.js";
import { logger } from "./logger.js";
import { performanceTracker } from "./performance.js";

/**
 * Input type for tracking preferences - occurrences is optional (defaults to 1)
 */
export type TrackPreferenceInput = Omit<UserPreference, 'id' | 'created_at' | 'updated_at' | 'occurrences'> & {
  occurrences?: number;
};

/**
 * Access strategy interface for different session memory access patterns
 */
export interface AccessStrategy {
  getContext(sessionId: string, key?: string): Promise<SessionContext[]>;
  storeContext(context: Omit<SessionContext, 'id' | 'created_at' | 'updated_at'>): Promise<void>;
  getPreferences(userId: string, key?: string): Promise<UserPreference[]>;
  trackPreference(preference: TrackPreferenceInput): Promise<void>;
  getConventions(projectId: string, language?: string, type?: string): Promise<ProjectConvention[]>;
  storeConvention(convention: Omit<ProjectConvention, 'id' | 'created_at' | 'updated_at'>): Promise<void>;
  getInteractions(sessionId: string, limit?: number): Promise<Interaction[]>;
  storeInteraction(interaction: Omit<Interaction, 'id' | 'created_at'>): Promise<void>;
  close(): Promise<void>;
}

/**
 * Direct database access strategy
 */
export class DirectDatabaseStrategy implements AccessStrategy {
  private pool: ConnectionPool;

  constructor(dbPath: string) {
    // Allow connection pool configuration via environment variables
    const maxConnections = parseInt(process.env.MCP_POOL_MAX_CONNECTIONS || '10', 10);
    const minConnections = parseInt(process.env.MCP_POOL_MIN_CONNECTIONS || '2', 10);
    
    this.pool = new ConnectionPool(dbPath, {}, { maxConnections, minConnections });
    
    logger.info('Connection pool initialized', { maxConnections, minConnections });
  }

  async getContext(sessionId: string, key?: string): Promise<SessionContext[]> {
    const startTime = Date.now();
    const endTimer = performanceTracker.start('strategy:getContext');
    
    try {
      // Check cache first
      const cacheKey = `context:${sessionId}:${key || 'all'}`;
      const cached = await cacheManager.get(cacheKey);
      if (cached) {
        endTimer();
        return cached;
      }

      const db = await this.pool.acquire();
      try {
        let query = "SELECT * FROM session_contexts WHERE session_id = ?";
        const params: any[] = [sessionId];

        if (key) {
          query += " AND key = ?";
          params.push(key);
        }

        query += " ORDER BY updated_at DESC LIMIT 100";

        const stmt = db.prepare(query);
        const results = stmt.all(...params) as SessionContext[];
        
        // Decrypt sensitive data if needed
        const decrypted = results.map(row => ({
          ...row,
          value: encryptionManager.isEncrypted(row.value) 
            ? encryptionManager.decrypt(row.value) 
            : row.value,
          metadata: row.metadata ? 
            (encryptionManager.isEncrypted(row.metadata) 
              ? JSON.parse(encryptionManager.decrypt(row.metadata))
              : JSON.parse(row.metadata)) 
            : undefined
        }));

        // Cache the result
        await cacheManager.set(cacheKey, decrypted, 300000); // 5 minutes
        
        endTimer();
        metricsCollector.record('getContext', Date.now() - startTime, true);
        return decrypted;
      } finally {
        this.pool.release(db);
      }
    } catch (error) {
      endTimer();
      metricsCollector.record('getContext', Date.now() - startTime, false);
      throw error;
    }
  }

  async storeContext(context: Omit<SessionContext, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    const startTime = Date.now();
    const endTimer = performanceTracker.start('strategy:storeContext');
    
    try {
      this.requireNonEmptyString(context.session_id, 'session_id');
      this.requireNonEmptyString(context.context_type, 'context_type');
      this.requireNonEmptyString(context.key, 'key');
      this.requireNonEmptyString(context.value, 'value');

      const db = await this.pool.acquire();
      try {
        const shouldEncrypt = this.isSensitiveData(context.key);
        
        const encryptedValue = shouldEncrypt 
          ? encryptionManager.encrypt(context.value)
          : context.value;
          
        const encryptedMetadata = context.metadata 
          ? encryptionManager.encrypt(JSON.stringify(context.metadata))
          : null;

        const stmt = db.prepare(`
          INSERT OR REPLACE INTO session_contexts 
          (session_id, context_type, key, value, metadata, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `);

        stmt.run(
          context.session_id,
          context.context_type,
          context.key,
          encryptedValue,
          encryptedMetadata
        );

        // Invalidate cache
        await cacheManager.delete(`context:${context.session_id}:${context.key}`);
        await cacheManager.delete(`context:${context.session_id}:all`);

        endTimer();
        metricsCollector.record('storeContext', Date.now() - startTime, true);
      } finally {
        this.pool.release(db);
      }
    } catch (error) {
      endTimer();
      metricsCollector.record('storeContext', Date.now() - startTime, false);
      throw error;
    }
  }

  async getPreferences(userId: string, key?: string): Promise<UserPreference[]> {
    const startTime = Date.now();
    const endTimer = performanceTracker.start('strategy:getPreferences');
    
    try {
      const cacheKey = `preferences:${userId}:${key || 'all'}`;
      const cached = await cacheManager.get(cacheKey);
      if (cached) {
        endTimer();
        return cached;
      }

      const db = await this.pool.acquire();
      try {
        let query = "SELECT * FROM user_preferences WHERE user_id = ?";
        const params: any[] = [userId];

        if (key) {
          query += " AND preference_key = ?";
          params.push(key);
        }

        query += " ORDER BY confidence DESC, updated_at DESC";

        const stmt = db.prepare(query);
        const results = stmt.all(...params) as UserPreference[];

        // Cache the result
        await cacheManager.set(cacheKey, results, 600000); // 10 minutes

        endTimer();
        metricsCollector.record('getPreferences', Date.now() - startTime, true);
        return results;
      } finally {
        this.pool.release(db);
      }
    } catch (error) {
      endTimer();
      metricsCollector.record('getPreferences', Date.now() - startTime, false);
      throw error;
    }
  }

  async trackPreference(preference: TrackPreferenceInput): Promise<void> {
    const startTime = Date.now();
    const endTimer = performanceTracker.start('strategy:trackPreference');
    
    try {
      const db = await this.pool.acquire();
      try {
        const stmt = db.prepare(`
          INSERT INTO user_preferences 
          (user_id, category, preference_key, preference_value, confidence, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, preference_key) DO UPDATE SET
            category = excluded.category,
            preference_value = excluded.preference_value,
            confidence = (confidence * occurrences + excluded.confidence) / (occurrences + 1),
            occurrences = occurrences + 1,
            updated_at = datetime('now')
        `);

        stmt.run(
          preference.user_id,
          preference.category,
          preference.preference_key,
          preference.preference_value,
          preference.confidence
        );

        // Invalidate cache
        await cacheManager.delete(`preferences:${preference.user_id}:${preference.preference_key}`);
        await cacheManager.delete(`preferences:${preference.user_id}:all`);

        endTimer();
        metricsCollector.record('trackPreference', Date.now() - startTime, true);
      } finally {
        this.pool.release(db);
      }
    } catch (error) {
      endTimer();
      metricsCollector.record('trackPreference', Date.now() - startTime, false);
      throw error;
    }
  }

  async getConventions(projectId: string, language?: string, type?: string): Promise<ProjectConvention[]> {
    const startTime = Date.now();
    const endTimer = performanceTracker.start('strategy:getConventions');
    
    try {
      const cacheKey = `conventions:${projectId}:${language || 'all'}:${type || 'all'}`;
      const cached = await cacheManager.get(cacheKey);
      if (cached) {
        endTimer();
        return cached;
      }

      const db = await this.pool.acquire();
      try {
        let query = "SELECT * FROM project_conventions WHERE project_id = ?";
        const params: any[] = [projectId];

        if (language) {
          query += " AND language = ?";
          params.push(language);
        }

        if (type) {
          query += " AND convention_type = ?";
          params.push(type);
        }

        query += " ORDER BY updated_at DESC";

        const stmt = db.prepare(query);
        const results = stmt.all(...params) as ProjectConvention[];

        // Cache the result
        await cacheManager.set(cacheKey, results, 900000); // 15 minutes

        endTimer();
        metricsCollector.record('getConventions', Date.now() - startTime, true);
        return results;
      } finally {
        this.pool.release(db);
      }
    } catch (error) {
      endTimer();
      metricsCollector.record('getConventions', Date.now() - startTime, false);
      throw error;
    }
  }

  async storeConvention(convention: Omit<ProjectConvention, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    const startTime = Date.now();
    const endTimer = performanceTracker.start('strategy:storeConvention');
    
    try {
      const db = await this.pool.acquire();
      try {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO project_conventions 
          (project_id, language, convention_type, convention_key, convention_value, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `);

        stmt.run(
          convention.project_id,
          convention.language,
          convention.convention_type,
          convention.convention_key,
          convention.convention_value
        );

        // Invalidate cache
        await cacheManager.delete(`conventions:${convention.project_id}:${convention.language}:${convention.convention_type}`);
        await cacheManager.delete(`conventions:${convention.project_id}:${convention.language}:all`);
        await cacheManager.delete(`conventions:${convention.project_id}:all:all`);

        endTimer();
        metricsCollector.record('storeConvention', Date.now() - startTime, true);
      } finally {
        this.pool.release(db);
      }
    } catch (error) {
      endTimer();
      metricsCollector.record('storeConvention', Date.now() - startTime, false);
      throw error;
    }
  }

  async getInteractions(sessionId: string, limit: number = 50): Promise<Interaction[]> {
    const startTime = Date.now();
    const endTimer = performanceTracker.start('strategy:getInteractions');
    
    try {
      const cacheKey = `interactions:${sessionId}:${limit}`;
      const cached = await cacheManager.get(cacheKey);
      if (cached) {
        endTimer();
        return cached;
      }

      const db = await this.pool.acquire();
      try {
        const stmt = db.prepare(`
          SELECT * FROM interactions 
          WHERE session_id = ? 
          ORDER BY created_at DESC, id DESC 
          LIMIT ?
        `);

        const results = stmt.all(sessionId, limit) as Interaction[];

        // Decrypt metadata if needed (keep as string to match Interaction type)
        const decrypted = results.map(row => ({
          ...row,
          metadata: row.metadata
            ? (encryptionManager.isEncrypted(row.metadata)
              ? encryptionManager.decrypt(row.metadata)
              : row.metadata)
            : undefined
        }));

        // Cache the result
        await cacheManager.set(cacheKey, decrypted, 180000); // 3 minutes

        endTimer();
        metricsCollector.record('getInteractions', Date.now() - startTime, true);
        return decrypted;
      } finally {
        this.pool.release(db);
      }
    } catch (error) {
      endTimer();
      metricsCollector.record('getInteractions', Date.now() - startTime, false);
      throw error;
    }
  }

  async storeInteraction(interaction: Omit<Interaction, 'id' | 'created_at'>): Promise<void> {
    const startTime = Date.now();
    const endTimer = performanceTracker.start('strategy:storeInteraction');
    
    try {
      this.requireNonEmptyString(interaction.session_id, 'session_id');
      this.requireNonEmptyString(interaction.role, 'role');
      this.requireNonEmptyString(interaction.content, 'content');

      let metadataObj: any = null;
      if (interaction.metadata !== undefined && interaction.metadata !== null) {
        if (typeof interaction.metadata === 'string') {
          try {
            metadataObj = JSON.parse(interaction.metadata);
          } catch {
            throw new Error('Invalid metadata JSON');
          }
        } else if (typeof interaction.metadata === 'object') {
          metadataObj = interaction.metadata;
        } else {
          throw new Error('Invalid metadata type');
        }
      }

      const db = await this.pool.acquire();
      try {
        const shouldEncrypt = this.isSensitiveData(interaction.content);
        
        const encryptedMetadata = metadataObj
          ? encryptionManager.encrypt(JSON.stringify(metadataObj))
          : null;

        const stmt = db.prepare(`
          INSERT INTO interactions (session_id, role, content, metadata, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `);

        stmt.run(
          interaction.session_id,
          interaction.role,
          interaction.content,
          encryptedMetadata
        );

        // Invalidate cache
        await cacheManager.delete(`interactions:${interaction.session_id}:50`);
        await cacheManager.delete(`interactions:${interaction.session_id}:20`);
        await cacheManager.delete(`interactions:${interaction.session_id}:10`);

        endTimer();
        metricsCollector.record('storeInteraction', Date.now() - startTime, true);
      } finally {
        this.pool.release(db);
      }
    } catch (error) {
      endTimer();
      metricsCollector.record('storeInteraction', Date.now() - startTime, false);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.pool.close();
  }

  /**
   * Determine if data should be encrypted based on key patterns
   */
  private requireNonEmptyString(value: any, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${fieldName} is required`);
    }
    return value;
  }

  private isSensitiveData(key: string): boolean {
    const sensitivePatterns = [
      'password', 'token', 'key', 'secret', 'credential',
      'auth', 'private', 'confidential', 'pii'
    ];
    
    return sensitivePatterns.some(pattern => 
      key.toLowerCase().includes(pattern)
    );
  }
}

/**
 * MCP Server access strategy (backward compatibility)
 */
export class MCPServerStrategy implements AccessStrategy {
  // TODO: Implement MCP server strategy for backward compatibility
  // This would use the existing MCP server protocol
  
  async getContext(sessionId: string, key?: string): Promise<SessionContext[]> {
    throw new Error('MCP Server strategy not implemented yet');
  }

  async storeContext(context: Omit<SessionContext, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    throw new Error('MCP Server strategy not implemented yet');
  }

  async getPreferences(userId: string, key?: string): Promise<UserPreference[]> {
    throw new Error('MCP Server strategy not implemented yet');
  }

  async trackPreference(preference: TrackPreferenceInput): Promise<void> {
    throw new Error('MCP Server strategy not implemented yet');
  }

  async getConventions(projectId: string, language?: string, type?: string): Promise<ProjectConvention[]> {
    throw new Error('MCP Server strategy not implemented yet');
  }

  async storeConvention(convention: Omit<ProjectConvention, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    throw new Error('MCP Server strategy not implemented yet');
  }

  async getInteractions(sessionId: string, limit?: number): Promise<Interaction[]> {
    throw new Error('MCP Server strategy not implemented yet');
  }

  async storeInteraction(interaction: Omit<Interaction, 'id' | 'created_at'>): Promise<void> {
    throw new Error('MCP Server strategy not implemented yet');
  }

  async close(): Promise<void> {
    // No cleanup needed for MCP strategy
  }
}

/**
 * Unified session memory client with multiple access strategies
 */
export class SessionMemoryClient {
  private strategy: AccessStrategy;
  private batchProcessor?: BatchProcessor;

  constructor(strategy: AccessStrategy) {
    this.strategy = strategy;
    
    // Initialize batch processor for bulk operations
    this.batchProcessor = new BatchProcessor(
      async (items: any[]) => {
        // Process batch based on item type
        const contexts = items.filter(item => item.type === 'context');
        const preferences = items.filter(item => item.type === 'preference');
        const conventions = items.filter(item => item.type === 'convention');
        const interactions = items.filter(item => item.type === 'interaction');

        await Promise.all([
          this.processBatchContexts(contexts),
          this.processBatchPreferences(preferences),
          this.processBatchConventions(conventions),
          this.processBatchInteractions(interactions)
        ]);
      },
      { batchSize: 50, timeout: 2000 }
    );
  }

  // Context management
  async getContext(sessionId: string, key?: string): Promise<SessionContext[]> {
    return this.strategy.getContext(sessionId, key);
  }

  async storeContext(context: Omit<SessionContext, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    return this.strategy.storeContext(context);
  }

  async batchStoreContexts(contexts: Omit<SessionContext, 'id' | 'created_at' | 'updated_at'>[]): Promise<void> {
    if (!this.batchProcessor) {
      throw new Error('Batch processor not initialized');
    }

    for (const context of contexts) {
      await this.batchProcessor.add({ type: 'context', data: context });
    }
    await this.batchProcessor.flush();
  }

  // User preferences
  async getPreferences(userId: string, key?: string): Promise<UserPreference[]> {
    return this.strategy.getPreferences(userId, key);
  }

  async trackPreference(preference: TrackPreferenceInput): Promise<void> {
    return this.strategy.trackPreference(preference);
  }

  async batchTrackPreferences(preferences: TrackPreferenceInput[]): Promise<void> {
    if (!this.batchProcessor) {
      throw new Error('Batch processor not initialized');
    }

    for (const preference of preferences) {
      await this.batchProcessor.add({ type: 'preference', data: preference });
    }
    await this.batchProcessor.flush();
  }

  // Project conventions
  async getConventions(projectId: string, language?: string, type?: string): Promise<ProjectConvention[]> {
    return this.strategy.getConventions(projectId, language, type);
  }

  async storeConvention(convention: Omit<ProjectConvention, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    return this.strategy.storeConvention(convention);
  }

  async batchStoreConventions(conventions: Omit<ProjectConvention, 'id' | 'created_at' | 'updated_at'>[]): Promise<void> {
    if (!this.batchProcessor) {
      throw new Error('Batch processor not initialized');
    }

    for (const convention of conventions) {
      await this.batchProcessor.add({ type: 'convention', data: convention });
    }
    await this.batchProcessor.flush();
  }

  // Interactions
  async getInteractions(sessionId: string, limit?: number): Promise<Interaction[]> {
    return this.strategy.getInteractions(sessionId, limit);
  }

  async storeInteraction(interaction: Omit<Interaction, 'id' | 'created_at'>): Promise<void> {
    return this.strategy.storeInteraction(interaction);
  }

  async batchStoreInteractions(interactions: Omit<Interaction, 'id' | 'created_at'>[]): Promise<void> {
    if (!this.batchProcessor) {
      throw new Error('Batch processor not initialized');
    }

    for (const interaction of interactions) {
      await this.batchProcessor.add({ type: 'interaction', data: interaction });
    }
    await this.batchProcessor.flush();
  }

  // Health and metrics
  async getHealth(): Promise<{ status: string; metrics: any }> {
    return {
      status: 'healthy',
      metrics: metricsCollector.getMetrics()
    };
  }

  async close(): Promise<void> {
    await this.batchProcessor?.flush();
    await this.strategy.close();
  }

  // Private batch processing methods
  private async processBatchContexts(contexts: any[]): Promise<void> {
    for (const { data } of contexts) {
      await this.strategy.storeContext(data);
    }
  }

  private async processBatchPreferences(preferences: any[]): Promise<void> {
    for (const { data } of preferences) {
      await this.strategy.trackPreference(data);
    }
  }

  private async processBatchConventions(conventions: any[]): Promise<void> {
    for (const { data } of conventions) {
      await this.strategy.storeConvention(data);
    }
  }

  private async processBatchInteractions(interactions: any[]): Promise<void> {
    for (const { data } of interactions) {
      await this.strategy.storeInteraction(data);
    }
  }
}

/**
 * Factory for creating session memory clients with different strategies
 */
export class SessionMemoryClientFactory {
  /**
   * Create client with direct database access (recommended)
   */
  static createDirectClient(dbPath: string): SessionMemoryClient {
    const strategy = new DirectDatabaseStrategy(dbPath);
    return new SessionMemoryClient(strategy);
  }

  /**
   * Create client with MCP server access (backward compatibility)
   */
  static createMCPClient(): SessionMemoryClient {
    const strategy = new MCPServerStrategy();
    return new SessionMemoryClient(strategy);
  }

  /**
   * Auto-detect and create appropriate client
   */
  static createAutoClient(dbPath?: string): SessionMemoryClient {
    // Prefer direct access for performance
    if (dbPath) {
      return this.createDirectClient(dbPath);
    }

    // Fallback to MCP if available
    if (typeof process !== 'undefined' && process.env?.MCP_SERVER_URL) {
      return this.createMCPClient();
    }

    throw new Error('Cannot determine session memory access method. Provide dbPath or configure MCP server.');
  }
}
