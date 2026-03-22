import { MigrationError } from './errors.js';
import { logger } from './logger.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: any) => void; // sql.js database type
  down: (db: any) => void; // sql.js database type
}

export class DatabaseMigrator {
  private migrations: Migration[] = [
    {
      version: 1,
      name: 'initial_schema',
      up: (db: any) => {
        logger.info('Migration v1: Initial schema (already applied)');
      },
      down: (db: any) => {
        logger.info('Migration v1: Cannot rollback initial schema');
      }
    },
    {
      version: 2,
      name: 'add_fts5_search',
      up: (db: any) => {
        logger.info('Migration v2: Adding FTS5 full-text search for session contexts');

        try {
          db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS session_contexts_fts USING fts5(
              session_id, context_type, key, value, 
              content='session_contexts', 
              content_rowid='id'
            );
          `);

          db.exec(`
            CREATE TRIGGER session_contexts_ai AFTER INSERT ON session_contexts BEGIN
              INSERT INTO session_contexts_fts(rowid, session_id, context_type, key, value)
              VALUES (new.id, new.session_id, new.context_type, new.key, new.value);
            END;
          `);

          db.exec(`
            CREATE TRIGGER session_contexts_ad AFTER DELETE ON session_contexts BEGIN
              DELETE FROM session_contexts_fts WHERE rowid = old.id;
            END;
          `);

          db.exec(`
            CREATE TRIGGER session_contexts_au AFTER UPDATE ON session_contexts BEGIN
              UPDATE session_contexts_fts SET
                session_id = new.session_id,
                context_type = new.context_type,
                key = new.key,
                value = new.value
              WHERE rowid = new.id;
            END;
          `);

          db.exec(`
            INSERT INTO session_contexts_fts(rowid, session_id, context_type, key, value)
            SELECT id, session_id, context_type, key, value FROM session_contexts;
          `);

          logger.info('Migration v2: FTS5 table and triggers created successfully');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const context = (error as any)?.context;
          const contextMessage =
            typeof context?.message === 'string'
              ? context.message
              : typeof context?.error?.message === 'string'
                ? context.error.message
                : '';
          const contextString = JSON.stringify(context ?? {});
          if (
            /fts5/i.test(message) ||
            /fts5/i.test(contextMessage) ||
            /no such module:\s*fts5/i.test(message) ||
            /no such module:\s*fts5/i.test(contextString)
          ) {
            logger.warn('Migration v2: FTS5 unavailable in current SQLite runtime; skipping FTS setup');
            return;
          }
          throw error;
        }
      },
      down: (db: any) => {
        logger.info('Migration v2: Removing FTS5 table and triggers');
        
        db.exec('DROP TRIGGER IF EXISTS session_contexts_ai');
        db.exec('DROP TRIGGER IF EXISTS session_contexts_ad');
        db.exec('DROP TRIGGER IF EXISTS session_contexts_au');
        db.exec('DROP TABLE IF EXISTS session_contexts_fts');
      }
    },
    {
      version: 3,
      name: 'add_entity_versioning',
      up: (db: any) => {
        logger.info('Migration v3: Adding entity versioning tables');
        
        db.exec(`
          CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            content TEXT NOT NULL,
            version INTEGER DEFAULT 1,
            project_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(name, entity_type, project_id)
          );
        `);

        db.exec(`
          CREATE TABLE IF NOT EXISTS entity_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            content TEXT NOT NULL,
            diff_summary TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
          );
        `);

        db.exec(`
          CREATE TABLE IF NOT EXISTS entity_relationships (
            from_entity_id TEXT NOT NULL,
            to_entity_id TEXT NOT NULL,
            relationship_type TEXT NOT NULL,
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (from_entity_id, to_entity_id, relationship_type),
            FOREIGN KEY (from_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
            FOREIGN KEY (to_entity_id) REFERENCES entities(id) ON DELETE CASCADE
          );
        `);

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_entities_type_project 
          ON entities(entity_type, project_id);
        `);

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_entity_versions_entity 
          ON entity_versions(entity_id, version DESC);
        `);

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_entity_relationships_from 
          ON entity_relationships(from_entity_id);
        `);

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_entity_relationships_to 
          ON entity_relationships(to_entity_id);
        `);

        logger.info('Migration v3: Entity tables and indexes created successfully');
      },
      down: (db: any) => {
        logger.info('Migration v3: Removing entity tables');
        
        db.exec('DROP TABLE IF EXISTS entity_relationships');
        db.exec('DROP TABLE IF EXISTS entity_versions');
        db.exec('DROP TABLE IF EXISTS entities');
      }
    },
    {
      version: 4,
      name: 'add_project_configs',
      up: (db: any) => {
        logger.info('Migration v4: Adding project configuration tables');
        
        db.exec(`
          CREATE TABLE IF NOT EXISTS project_configs (
            project_id TEXT PRIMARY KEY,
            project_name TEXT NOT NULL,
            root_path TEXT,
            language_primary TEXT,
            frameworks TEXT,
            conventions TEXT,
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        db.exec(`
          CREATE TABLE IF NOT EXISTS project_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT,
            last_modified TIMESTAMP,
            content_hash TEXT,
            metadata TEXT,
            UNIQUE(project_id, file_path),
            FOREIGN KEY (project_id) REFERENCES project_configs(project_id) ON DELETE CASCADE
          );
        `);

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_project_files_project 
          ON project_files(project_id);
        `);

        logger.info('Migration v4: Project configuration tables created successfully');
      },
      down: (db: any) => {
        logger.info('Migration v4: Removing project configuration tables');
        
        db.exec('DROP TABLE IF EXISTS project_files');
        db.exec('DROP TABLE IF EXISTS project_configs');
      }
    },
    {
      version: 5,
      name: 'add_category_to_user_preferences',
      up: (db: any) => {
        logger.info('Migration v5: Adding category column to user_preferences');
        
        const row = db.prepare(
          `SELECT COUNT(*) as count FROM pragma_table_info('user_preferences') WHERE name = 'category'`
        ).get() as { count?: number } | undefined;
        const exists = (row?.count || 0) > 0;

        if (!exists) {
          db.exec(`ALTER TABLE user_preferences ADD COLUMN category TEXT NOT NULL DEFAULT 'general'`);
          logger.info('Migration v5: category column added successfully');
        } else {
          logger.info('Migration v5: category column already exists');
        }
      },
      down: (db: any) => {
        logger.info('Migration v5: Cannot remove category column (SQLite limitation)');
      }
    },
    {
      version: 6,
      name: 'add_enhanced_task_tracking',
      up: (db: any) => {
        logger.info('Migration v6: Adding enhanced task tracking with phases');
        
        // Helper function for column checks with sql.js
        const columnExists = (tableName: string, columnName: string): boolean => {
          const row = db.prepare(
            `SELECT COUNT(*) as count FROM pragma_table_info('${tableName}') WHERE name = '${columnName}'`
          ).get() as { count?: number } | undefined;
          return (row?.count || 0) > 0;
        };

        // Add project_id to tasks for cross-project support
        if (!columnExists('tasks', 'project_id')) {
          db.exec(`ALTER TABLE tasks ADD COLUMN project_id TEXT`);
        }

        // Add phase tracking
        if (!columnExists('tasks', 'phase')) {
          db.exec(`ALTER TABLE tasks ADD COLUMN phase TEXT`);
        }

        // Add progress tracking
        if (!columnExists('tasks', 'progress')) {
          db.exec(`ALTER TABLE tasks ADD COLUMN progress INTEGER DEFAULT 0`);
        }

        // Add estimated_hours
        if (!columnExists('tasks', 'estimated_hours')) {
          db.exec(`ALTER TABLE tasks ADD COLUMN estimated_hours REAL`);
        }

        // Add actual_hours
        if (!columnExists('tasks', 'actual_hours')) {
          db.exec(`ALTER TABLE tasks ADD COLUMN actual_hours REAL`);
        }

        // Add tags column
        if (!columnExists('tasks', 'tags')) {
          db.exec(`ALTER TABLE tasks ADD COLUMN tags TEXT`);
        }

        // Create task phases table
        db.exec(`
          CREATE TABLE IF NOT EXISTS task_phases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            display_order INTEGER NOT NULL,
            color TEXT,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          INSERT OR IGNORE INTO task_phases (name, display_order, color, description) VALUES
            ('backlog', 0, '#6b7280', 'Tasks not yet started'),
            ('planning', 1, '#3b82f6', 'Tasks being planned'),
            ('in_progress', 2, '#f59e0b', 'Tasks currently being worked on'),
            ('review', 3, '#8b5cf6', 'Tasks under review'),
            ('testing', 4, '#06b6d4', 'Tasks being tested'),
            ('done', 5, '#22c55e', 'Completed tasks'),
            ('blocked', 6, '#ef4444', 'Blocked tasks');
        `);

        // Create index for project-based queries
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, state);
          CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase, state);
        `);

        logger.info('Migration v6: Enhanced task tracking added successfully');
      },
      down: (db: any) => {
        logger.info('Migration v6: Cannot remove columns (SQLite limitation)');
        db.exec('DROP TABLE IF EXISTS task_phases');
      }
    },
    {
      version: 7,
      name: 'add_analytics_tables',
      up: (db: any) => {
        logger.info('Migration v7: Adding analytics and tagging tables');

        // Memory tags table
        db.exec(`
          CREATE TABLE IF NOT EXISTS memory_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            memory_type TEXT NOT NULL,
            tag TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(memory_id, memory_type, tag)
          );
          CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);
          CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id, memory_type);
        `);

        // Embeddings table for semantic search
        db.exec(`
          CREATE TABLE IF NOT EXISTS memory_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            memory_type TEXT NOT NULL,
            embedding BLOB,
            model_version TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(memory_id, memory_type)
          );
        `);

        // Analytics cache
        db.exec(`
          CREATE TABLE IF NOT EXISTS analytics_cache (
            cache_key TEXT PRIMARY KEY,
            cache_value TEXT NOT NULL,
            computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP
          );
        `);

        // Routing patterns for cross-workflow learning
        db.exec(`
          CREATE TABLE IF NOT EXISTS routing_patterns (
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
          CREATE INDEX IF NOT EXISTS idx_routing_patterns_confidence ON routing_patterns(confidence DESC);
        `);

        logger.info('Migration v7: Analytics tables added successfully');
      },
      down: (db: any) => {
        logger.info('Migration v7: Removing analytics tables');
        db.exec('DROP TABLE IF EXISTS memory_tags');
        db.exec('DROP TABLE IF EXISTS memory_embeddings');
        db.exec('DROP TABLE IF EXISTS analytics_cache');
        db.exec('DROP TABLE IF EXISTS routing_patterns');
      }
    },
    {
      version: 8,
      name: 'add_project_profiles',
      up: (db: any) => {
        logger.info('Migration v8: Adding project profiles table');

        db.exec(`
          CREATE TABLE IF NOT EXISTS project_profiles (
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
          CREATE INDEX IF NOT EXISTS idx_project_profiles_language ON project_profiles(primary_language);
          CREATE INDEX IF NOT EXISTS idx_project_profiles_accessed ON project_profiles(last_accessed DESC);
        `);

        logger.info('Migration v8: Project profiles table added successfully');
      },
      down: (db: any) => {
        logger.info('Migration v8: Removing project profiles table');
        db.exec('DROP TABLE IF EXISTS project_profiles');
      }
    },
    {
      version: 9,
      name: 'add_enhanced_memory_system',
      up: (db: any) => {
        logger.info('Migration v9: Adding enhanced memory system (branch-aware, entity extraction, evolution tracking)');

        // Helper function for column checks with sql.js
        const columnExists = (tableName: string, columnName: string): boolean => {
          const row = db.prepare(
            `SELECT COUNT(*) as count FROM pragma_table_info('${tableName}') WHERE name = '${columnName}'`
          ).get() as { count?: number } | undefined;
          return (row?.count || 0) > 0;
        };

        // Add branch awareness to session_contexts
        if (!columnExists('session_contexts', 'git_branch')) {
          db.exec(`ALTER TABLE session_contexts ADD COLUMN git_branch TEXT`);
        }

        // Add memory type classification (decision, preference, learning, task, etc.)
        if (!columnExists('session_contexts', 'memory_type')) {
          db.exec(`ALTER TABLE session_contexts ADD COLUMN memory_type TEXT DEFAULT 'info'`);
        }

        // Add importance level (critical, high, normal, low)
        if (!columnExists('session_contexts', 'importance')) {
          db.exec(`ALTER TABLE session_contexts ADD COLUMN importance TEXT DEFAULT 'normal'`);
        }

        // Add access count for tracking usage patterns
        if (!columnExists('session_contexts', 'access_count')) {
          db.exec(`ALTER TABLE session_contexts ADD COLUMN access_count INTEGER DEFAULT 0`);
        }

        // Memory entities table - for intelligent retrieval
        db.exec(`
          CREATE TABLE IF NOT EXISTS memory_entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            entity_name TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(memory_id, entity_name, entity_type)
          );
          CREATE INDEX IF NOT EXISTS idx_memory_entities_name ON memory_entities(entity_name);
          CREATE INDEX IF NOT EXISTS idx_memory_entities_type ON memory_entities(entity_type);
          CREATE INDEX IF NOT EXISTS idx_memory_entities_memory ON memory_entities(memory_id);
        `);

        // Memory evolutions table - track changes over time
        db.exec(`
          CREATE TABLE IF NOT EXISTS memory_evolutions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            evolution_note TEXT NOT NULL,
            previous_value TEXT,
            changed_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_memory_evolutions_memory ON memory_evolutions(memory_id);
          CREATE INDEX IF NOT EXISTS idx_memory_evolutions_created ON memory_evolutions(created_at DESC);
        `);

        // Branch memory inheritance table - tracks which branches inherit from which
        db.exec(`
          CREATE TABLE IF NOT EXISTS branch_memory_inheritance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            child_branch TEXT NOT NULL,
            parent_branch TEXT NOT NULL,
            inherited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            project_id TEXT,
            UNIQUE(child_branch, parent_branch, project_id)
          );
          CREATE INDEX IF NOT EXISTS idx_branch_inheritance_child ON branch_memory_inheritance(child_branch);
        `);

        // Create indexes for branch-aware queries
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_session_contexts_branch ON session_contexts(git_branch);
          CREATE INDEX IF NOT EXISTS idx_session_contexts_type ON session_contexts(memory_type);
          CREATE INDEX IF NOT EXISTS idx_session_contexts_importance ON session_contexts(importance);
        `);

        // Try to create FTS5 for full-text memory search
        try {
          db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
              session_id, key, value, memory_type, git_branch,
              content='session_contexts',
              content_rowid='id'
            );
          `);

          // Populate FTS with existing data
          db.exec(`
            INSERT OR IGNORE INTO memory_fts(rowid, session_id, key, value, memory_type, git_branch)
            SELECT id, session_id, key, value, 
                   COALESCE(memory_type, 'info'), 
                   COALESCE(git_branch, 'main')
            FROM session_contexts;
          `);

          logger.info('Migration v9: FTS5 full-text search enabled for memories');
        } catch (error) {
          logger.warn('Migration v9: FTS5 not available, will use LIKE queries for search');
        }

        logger.info('Migration v9: Enhanced memory system added successfully');
      },
      down: (db: any) => {
        logger.info('Migration v9: Removing enhanced memory system');
        db.exec('DROP TABLE IF EXISTS memory_fts');
        db.exec('DROP TABLE IF EXISTS branch_memory_inheritance');
        db.exec('DROP TABLE IF EXISTS memory_evolutions');
        db.exec('DROP TABLE IF EXISTS memory_entities');
        // Note: Cannot remove columns from session_contexts (SQLite limitation)
      }
    }
    ,
    {
      version: 10,
      name: 'add_tool_idempotency',
      up: (db: any) => {
        logger.info('Migration v10: Adding idempotency table for tool writes');

        db.exec(`
          CREATE TABLE IF NOT EXISTS tool_idempotency (
            idempotency_key TEXT PRIMARY KEY,
            tool_name TEXT NOT NULL,
            response_text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );
        `);

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_tool_idempotency_tool_name
          ON tool_idempotency(tool_name);
        `);

        logger.info('Migration v10: tool_idempotency table created');
      },
      down: (db: any) => {
        logger.info('Migration v10: Removing tool_idempotency');
        db.exec('DROP TABLE IF EXISTS tool_idempotency');
      }
    },
    {
      version: 11,
      name: 'add_operational_memory_tables',
      up: (db: any) => {
        logger.info('Migration v11: Adding operational memory tables for proactive resurfacing');

        db.exec(`
          CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            priority INTEGER NOT NULL DEFAULT 3,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );

          CREATE TABLE IF NOT EXISTS operational_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            project_id INTEGER,
            status TEXT NOT NULL DEFAULT 'open',
            priority INTEGER NOT NULL DEFAULT 3,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            due_at TEXT,
            last_seen_at TEXT,
            resurfacing_score REAL NOT NULL DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS open_loops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            source TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            last_seen_at TEXT
          );

          CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            due_at TEXT,
            priority INTEGER NOT NULL DEFAULT 3,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );

          CREATE TABLE IF NOT EXISTS artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            artifact_type TEXT,
            path TEXT,
            project_id INTEGER,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS work_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_key TEXT NOT NULL UNIQUE,
            summary TEXT,
            started_at TEXT,
            ended_at TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );

          CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, priority);
          CREATE INDEX IF NOT EXISTS idx_operational_tasks_status ON operational_tasks(status, priority);
          CREATE INDEX IF NOT EXISTS idx_operational_tasks_due ON operational_tasks(due_at);
          CREATE INDEX IF NOT EXISTS idx_operational_tasks_resurface ON operational_tasks(resurfacing_score DESC);
          CREATE INDEX IF NOT EXISTS idx_open_loops_last_seen ON open_loops(last_seen_at);
          CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);
          CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, status);
        `);

        logger.info('Migration v11: Operational memory tables created');
      },
      down: (db: any) => {
        logger.info('Migration v11: Removing operational memory tables');
        db.exec('DROP TABLE IF EXISTS work_sessions');
        db.exec('DROP TABLE IF EXISTS artifacts');
        db.exec('DROP TABLE IF EXISTS reminders');
        db.exec('DROP TABLE IF EXISTS open_loops');
        db.exec('DROP TABLE IF EXISTS operational_tasks');
        db.exec('DROP TABLE IF EXISTS projects');
      }
    }
  ];

  getCurrentVersion(db: any): number {
    try {
      const result = db.prepare('PRAGMA user_version').get() as { user_version?: number | string } | undefined;
      const v = (result as any)?.user_version;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
      return 0;
    } catch (error) {
      logger.error('Failed to get current database version', error as Error);
      return 0;
    }
  }

  setVersion(db: any, version: number): void {
    try {
      db.prepare(`PRAGMA user_version = ${version}`).run();
      logger.info(`Database version updated to ${version}`);
    } catch (error) {
      throw new MigrationError(`Failed to set database version to ${version}`, { error });
    }
  }

  migrate(db: any, targetVersion?: number): void {
    const currentVersion = this.getCurrentVersion(db);
    const target = targetVersion || this.migrations.length;

    logger.info(`Starting migration from version ${currentVersion} to ${target}`);

    if (currentVersion === target) {
      logger.info('Database is already at target version');
      return;
    }

    try {
      if (currentVersion < target) {
        for (let i = currentVersion; i < target; i++) {
          const migration = this.migrations[i];
          logger.info(`Applying migration ${migration.version}: ${migration.name}`);
          
          db.prepare('BEGIN').run();
          try {
            migration.up(db);
            this.setVersion(db, migration.version);
            db.prepare('COMMIT').run();
            logger.info(`Migration ${migration.version} applied successfully`);
          } catch (error) {
            db.prepare('ROLLBACK').run();
            throw new MigrationError(
              `Failed to apply migration ${migration.version}: ${migration.name}`,
              { error }
            );
          }
        }
      } else if (currentVersion > target) {
        for (let i = currentVersion - 1; i >= target; i--) {
          const migration = this.migrations[i];
          logger.info(`Rolling back migration ${migration.version}: ${migration.name}`);
          
          db.prepare('BEGIN').run();
          try {
            migration.down(db);
            this.setVersion(db, i);
            db.prepare('COMMIT').run();
            logger.info(`Migration ${migration.version} rolled back successfully`);
          } catch (error) {
            db.prepare('ROLLBACK').run();
            throw new MigrationError(
              `Failed to rollback migration ${migration.version}: ${migration.name}`,
              { error }
            );
          }
        }
      }

      logger.info(`Migration completed successfully. Current version: ${this.getCurrentVersion(db)}`);
    } catch (error) {
      logger.error('Migration failed', error as Error);
      throw error;
    }
  }

  listMigrations(): Migration[] {
    return this.migrations.map(m => ({ ...m }));
  }
}

export const migrator = new DatabaseMigrator();
