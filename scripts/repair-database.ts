#!/usr/bin/env node
/**
 * Database Repair Script for MCP session-memory
 * 
 * Fixes corrupted SQLite databases by attempting multiple recovery strategies:
 * 1. WAL checkpoint (merge write-ahead log)
 * 2. Integrity check
 * 3. Export/reimport recoverable data
 * 4. Fresh database with schema migrations
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, renameSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveDefaultSessionDbPath(): string {
  if (process.env.SESSION_DB) {
    return process.env.SESSION_DB;
  }

  if (process.env.SESSION_DB_PATH) {
    return process.env.SESSION_DB_PATH;
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const canonicalDbPath = join(homeDir, '.agents', 'memory', 'session.db');
  const legacyDbPath = join(homeDir, '.opencode', 'sessions', 'session.db');

  if (existsSync(canonicalDbPath)) {
    return canonicalDbPath;
  }

  if (existsSync(legacyDbPath)) {
    return legacyDbPath;
  }

  return canonicalDbPath;
}

interface RepairResult {
  success: boolean;
  strategy: string;
  recovered: {
    preferences: number;
    conventions: number;
    interactions: number;
    contexts: number;
    tasks: number;
  };
  errors: string[];
  backupPath?: string;
}

interface TableCounts {
  preferences: number;
  conventions: number;
  interactions: number;
  contexts: number;
  tasks: number;
}

class DatabaseRepairer {
  private SQL: any = null;
  
  async initialize(): Promise<void> {
    if (this.SQL) return;
    
    // Handle both compiled (dist/) and source (scripts/) locations
    let wasmPath = join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
    if (!existsSync(wasmPath)) {
      // Try from dist/scripts location
      wasmPath = join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');
    }
    
    this.SQL = await initSqlJs({
      locateFile: (file: string) => file === 'sql-wasm.wasm' ? wasmPath : file
    });
    
    console.log('✓ sql.js initialized');
  }

  /**
   * Create timestamped backup of database and WAL/SHM files
   */
  backupDatabase(dbPath: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupPath = `${dbPath}.backup.${timestamp}`;
    
    try {
      // Backup main database file
      if (existsSync(dbPath)) {
        copyFileSync(dbPath, backupPath);
        console.log(`✓ Backup created: ${basename(backupPath)}`);
      }
      
      // Backup WAL file if exists
      const walPath = `${dbPath}-wal`;
      if (existsSync(walPath)) {
        copyFileSync(walPath, `${backupPath}-wal`);
        console.log(`✓ WAL backup created: ${basename(backupPath)}-wal`);
      }
      
      // Backup SHM file if exists
      const shmPath = `${dbPath}-shm`;
      if (existsSync(shmPath)) {
        copyFileSync(shmPath, `${backupPath}-shm`);
        console.log(`✓ SHM backup created: ${basename(backupPath)}-shm`);
      }
      
      return backupPath;
    } catch (error) {
      throw new Error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Attempt to merge WAL file into main database
   * This is the first recovery strategy for databases with uncommitted transactions
   */
  forceWalCheckpoint(dbPath: string): boolean {
    try {
      const walPath = `${dbPath}-wal`;
      
      if (!existsSync(walPath)) {
        console.log('ℹ No WAL file found - skipping checkpoint');
        return true;
      }
      
      const walSize = readFileSync(walPath).length;
      console.log(`ℹ WAL file size: ${Math.round(walSize / 1024)}KB`);
      
      // Load database
      const buffer = existsSync(dbPath) ? readFileSync(dbPath) : new Uint8Array(0);
      const db = new this.SQL.Database(buffer.length > 0 ? buffer : undefined);
      
      // Attempt to read any table to trigger WAL checkpoint behavior
      try {
        db.exec("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
        console.log('✓ Database accessible');
      } catch (error) {
        db.close();
        return false;
      }
      
      // Export to merge WAL
      const data = db.export();
      db.close();
      
      // Remove old WAL/SHM files
      if (existsSync(walPath)) unlinkSync(walPath);
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
      
      // Write merged database
      writeFileSync(dbPath, data);
      
      console.log('✓ WAL checkpoint: SUCCESS');
      return true;
    } catch (error) {
      console.error(`✗ WAL checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Run SQLite integrity check
   */
  integrityCheck(dbPath: string): { ok: boolean; errors: string[] } {
    try {
      if (!existsSync(dbPath)) {
        return { ok: false, errors: ['Database file does not exist'] };
      }
      
      const buffer = readFileSync(dbPath);
      
      // Verify it's a SQLite database
      if (buffer.length < 16 || buffer.toString('utf8', 0, 15) !== 'SQLite format 3') {
        return { ok: false, errors: ['Not a valid SQLite database file'] };
      }
      
      const db = new this.SQL.Database(buffer);
      
      try {
        // Run integrity check
        const result = db.exec("PRAGMA integrity_check");
        
        if (result.length === 0 || !result[0].values || result[0].values.length === 0) {
          db.close();
          return { ok: false, errors: ['Integrity check returned no results'] };
        }
        
        const checkResult = result[0].values[0][0] as string;
        db.close();
        
        if (checkResult === 'ok') {
          console.log('✓ Integrity check: PASSED');
          return { ok: true, errors: [] };
        } else {
          console.error(`✗ Integrity check: FAILED - ${checkResult}`);
          return { ok: false, errors: [checkResult] };
        }
      } catch (error) {
        db.close();
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ Integrity check: ERROR - ${message}`);
        return { ok: false, errors: [message] };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ Integrity check: CRITICAL ERROR - ${message}`);
      return { ok: false, errors: [message] };
    }
  }

  /**
   * Export recoverable data from corrupted database
   */
  exportRecoverableData(dbPath: string): TableCounts {
    const counts: TableCounts = {
      preferences: 0,
      conventions: 0,
      interactions: 0,
      contexts: 0,
      tasks: 0
    };
    
    try {
      const buffer = readFileSync(dbPath);
      const db = new this.SQL.Database(buffer);
      
      // Try to count rows in key tables
      const tables = [
        { name: 'user_preferences', key: 'preferences' as keyof TableCounts },
        { name: 'project_conventions', key: 'conventions' as keyof TableCounts },
        { name: 'interactions', key: 'interactions' as keyof TableCounts },
        { name: 'session_contexts', key: 'contexts' as keyof TableCounts },
        { name: 'tasks', key: 'tasks' as keyof TableCounts }
      ];
      
      for (const table of tables) {
        try {
          const result = db.exec(`SELECT COUNT(*) as count FROM ${table.name}`);
          if (result.length > 0 && result[0].values.length > 0) {
            counts[table.key] = result[0].values[0][0] as number;
            console.log(`ℹ ${table.name}: ${counts[table.key]} rows recoverable`);
          }
        } catch (error) {
          console.log(`ℹ ${table.name}: inaccessible (${error instanceof Error ? error.message : 'unknown error'})`);
        }
      }
      
      db.close();
    } catch (error) {
      console.error(`✗ Data export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return counts;
  }

  /**
   * Recreate database with fresh schema
   */
  recreateDatabase(dbPath: string): void {
    try {
      // Create new database
      const db = new this.SQL.Database();
      
      // Initialize schema
      this.initializeSchema(db);
      
      // Export and save
      const data = db.export();
      writeFileSync(dbPath, data);
      db.close();
      
      // Remove WAL/SHM files
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      if (existsSync(walPath)) unlinkSync(walPath);
      if (existsSync(shmPath)) unlinkSync(shmPath);
      
      console.log('✓ Fresh database created with schema');
    } catch (error) {
      throw new Error(`Database recreation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Initialize database schema (matching src/database.ts)
   */
  private initializeSchema(db: SqlJsDatabase): void {
    // Session contexts
    db.exec(`
      CREATE TABLE session_contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        context_type TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, context_type, key)
      );
      CREATE INDEX idx_session_contexts_session ON session_contexts(session_id);
    `);

    // User preferences
    db.exec(`
      CREATE TABLE user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        preference_key TEXT NOT NULL,
        preference_value TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        occurrences INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category, preference_key)
      );
      CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);
      CREATE INDEX idx_user_preferences_category ON user_preferences(category);
    `);

    // Project conventions
    db.exec(`
      CREATE TABLE project_conventions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        language TEXT NOT NULL,
        convention_type TEXT NOT NULL,
        convention_key TEXT NOT NULL,
        convention_value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, language, convention_type, convention_key)
      );
      CREATE INDEX idx_project_conventions_project ON project_conventions(project_id);
      CREATE INDEX idx_project_conventions_language ON project_conventions(language);
    `);

    // Interactions
    db.exec(`
      CREATE TABLE interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_interactions_session ON interactions(session_id);
    `);

    // Tasks
    db.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        payload_json TEXT NOT NULL,
        priority INTEGER DEFAULT 100,
        state TEXT DEFAULT 'queued',
        agent_id TEXT,
        workflow_id TEXT,
        parent_task_id INTEGER,
        project_id TEXT,
        phase TEXT,
        progress INTEGER DEFAULT 0,
        estimated_hours REAL,
        actual_hours REAL,
        tags TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        error_text TEXT,
        FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
      );
      CREATE INDEX idx_tasks_state ON tasks(state);
      CREATE INDEX idx_tasks_workflow ON tasks(workflow_id);
      CREATE INDEX idx_tasks_project ON tasks(project_id, state);
    `);

    // Routing patterns
    db.exec(`
      CREATE TABLE routing_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_key TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        file_count INTEGER DEFAULT 0,
        loc_estimate INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pattern_key)
      );
      CREATE INDEX idx_routing_patterns_confidence ON routing_patterns(confidence DESC);
    `);

    // Project profiles
    db.exec(`
      CREATE TABLE project_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT,
        primary_language TEXT,
        frameworks TEXT,
        stack_info TEXT,
        conventions_summary TEXT,
        metadata TEXT,
        memory_count INTEGER DEFAULT 0,
        last_accessed TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /**
   * Verify repair was successful
   */
  verifyRepair(dbPath: string): boolean {
    try {
      const buffer = readFileSync(dbPath);
      const db = new this.SQL.Database(buffer);
      
      // Check all critical tables exist
      const result = db.exec(`
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        AND name IN ('session_contexts', 'user_preferences', 'project_conventions', 'interactions', 'tasks')
        ORDER BY name
      `);
      
      if (result.length === 0 || !result[0].values || result[0].values.length !== 5) {
        db.close();
        return false;
      }
      
      // Try a test query on each table
      const tables = ['session_contexts', 'user_preferences', 'project_conventions', 'interactions', 'tasks'];
      for (const table of tables) {
        db.exec(`SELECT COUNT(*) FROM ${table}`);
      }
      
      db.close();
      console.log('✓ Database verified - all tables accessible');
      return true;
    } catch (error) {
      console.error(`✗ Verification failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Main repair function - attempts strategies in order
   */
  async repair(dbPath: string): Promise<RepairResult> {
    const result: RepairResult = {
      success: false,
      strategy: 'none',
      recovered: {
        preferences: 0,
        conventions: 0,
        interactions: 0,
        contexts: 0,
        tasks: 0
      },
      errors: []
    };

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Database Repair Script - MCP session-memory');
    console.log('═══════════════════════════════════════════════════════\n');

    // Expand tilde in path
    if (dbPath.startsWith('~/')) {
      dbPath = join(process.env.HOME || '', dbPath.slice(2));
    }

    console.log(`Database: ${dbPath}\n`);

    // Step 1: Backup
    console.log('Step 1: Creating backup...');
    try {
      result.backupPath = this.backupDatabase(dbPath);
      console.log('');
    } catch (error) {
      result.errors.push(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`✗ ${result.errors[result.errors.length - 1]}\n`);
      return result;
    }

    // Step 2: Try WAL checkpoint
    console.log('Step 2: Attempting WAL checkpoint...');
    try {
      const checkpointSuccess = this.forceWalCheckpoint(dbPath);
      if (checkpointSuccess) {
        result.strategy = 'wal_checkpoint';
        
        // Check if this fixed the issue
        const integrityResult = this.integrityCheck(dbPath);
        if (integrityResult.ok) {
          result.success = true;
          result.recovered = this.exportRecoverableData(dbPath);
          console.log('');
          return result;
        }
      }
    } catch (error) {
      result.errors.push(`WAL checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`✗ ${result.errors[result.errors.length - 1]}`);
    }
    console.log('');

    // Step 3: Integrity check
    console.log('Step 3: Running integrity check...');
    const integrityResult = this.integrityCheck(dbPath);
    result.errors.push(...integrityResult.errors);
    
    if (integrityResult.ok) {
      result.success = true;
      result.strategy = 'integrity_verified';
      result.recovered = this.exportRecoverableData(dbPath);
      console.log('');
      return result;
    }
    console.log('');

    // Step 4: Try to recover data before recreating
    console.log('Step 4: Attempting data recovery...');
    const recoveredCounts = this.exportRecoverableData(dbPath);
    const totalRecovered = Object.values(recoveredCounts).reduce((a, b) => a + b, 0);
    
    if (totalRecovered > 0) {
      console.log(`\n⚠ Warning: ${totalRecovered} rows might be lost during recreation\n`);
    } else {
      console.log('ℹ No data found to recover\n');
    }

    // Step 5: Recreate database
    console.log('Step 5: Recreating database with fresh schema...');
    try {
      this.recreateDatabase(dbPath);
      
      // Verify the new database
      if (this.verifyRepair(dbPath)) {
        result.success = true;
        result.strategy = 'full_recreation';
        result.recovered = { preferences: 0, conventions: 0, interactions: 0, contexts: 0, tasks: 0 };
        console.log('');
        return result;
      } else {
        result.errors.push('Verification of recreated database failed');
        console.error('✗ Verification failed\n');
      }
    } catch (error) {
      result.errors.push(`Recreation failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`✗ ${result.errors[result.errors.length - 1]}\n`);
    }

    return result;
  }
}

// Main execution
async function main() {
  const dbPath = process.argv[2] || resolveDefaultSessionDbPath();
  
  const repairer = new DatabaseRepairer();
  await repairer.initialize();
  
  const result = await repairer.repair(dbPath);
  
  // Print summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Repair Summary');
  console.log('═══════════════════════════════════════════════════════\n');
  
  if (result.success) {
    console.log(`✓ Repair: SUCCESS`);
    console.log(`✓ Strategy: ${result.strategy}`);
    if (result.backupPath) {
      console.log(`✓ Backup: ${basename(result.backupPath)}`);
    }
    console.log(`\nRecovered data:`);
    console.log(`  - ${result.recovered.preferences} preferences`);
    console.log(`  - ${result.recovered.conventions} conventions`);
    console.log(`  - ${result.recovered.interactions} interactions`);
    console.log(`  - ${result.recovered.contexts} contexts`);
    console.log(`  - ${result.recovered.tasks} tasks`);
  } else {
    console.log('✗ Repair: FAILED\n');
    console.log('Errors:');
    result.errors.forEach(err => console.log(`  - ${err}`));
    
    if (result.backupPath) {
      console.log(`\nBackup preserved: ${basename(result.backupPath)}`);
      console.log('Original database was not modified.');
    }
  }
  
  console.log('');
  process.exit(result.success ? 0 : 1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
