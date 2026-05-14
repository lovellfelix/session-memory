import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { createHash } from "crypto"
import initSqlJs, { Database as SqlJsDatabase } from "sql.js"
import { DatabaseError, ValidationError } from "./errors.js"
import { logger } from "./logger.js"
import { performanceTracker } from "./performance.js"
import { migrator } from "./migrations.js"
import { AnalyticsEngine } from "./analytics.js"

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Helper to add columns if they don't exist
const safeAddColumn = (db: any, table: string, column: string, type: string) => {
  try {
    const row = db.prepare(`SELECT COUNT(*) as count FROM pragma_table_info('${table}') WHERE name = '${column}'`).get() as { count?: number } | undefined
    if (!row?.count) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  } catch {
    // Ignore errors — column may already exist
  }
}

// Unified database interface for sql.js
interface DatabaseAdapter {
  prepare(sql: string): StatementAdapter
  exec(sql: string): void
  close(): void
  export(): Uint8Array
}

interface StatementAdapter {
  run(...params: any[]): { changes: number; lastInsertRowid: number }
  get(...params: any[]): any
  all(...params: any[]): any[]
}

// Global sql.js module instance
let SQL: any = null

async function initializeSqlJs(): Promise<any> {
  if (SQL) return SQL

  // Locate WASM file in node_modules
  const wasmPath = join(__dirname, "../node_modules/sql.js/dist/sql-wasm.wasm")

  SQL = await initSqlJs({
    locateFile: (file: string) => {
      // Use local WASM file for Node.js environment
      if (file === "sql-wasm.wasm") {
        return wasmPath
      }
      return file
    },
  })

  logger.info("sql.js initialized")
  return SQL
}

// Adapter wrapper for sql.js to match better-sqlite3 API
class SqlJsAdapter implements DatabaseAdapter {
  private db: SqlJsDatabase
  private dbPath: string
  private dirty: boolean = false
  private flushTimer: NodeJS.Timeout | null = null
  private flushIntervalMs: number
  private maxFlushIntervalMs: number
  private lastFlushAtMs: number = 0

  constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db
    this.dbPath = dbPath
    this.flushIntervalMs = Number.parseInt(process.env.SESSION_MEMORY_FLUSH_MS || "25", 10)
    if (Number.isNaN(this.flushIntervalMs) || this.flushIntervalMs < 0) this.flushIntervalMs = 25
    this.maxFlushIntervalMs = Number.parseInt(process.env.SESSION_MEMORY_MAX_FLUSH_MS || "250", 10)
    if (Number.isNaN(this.maxFlushIntervalMs) || this.maxFlushIntervalMs < 0)
      this.maxFlushIntervalMs = 250
  }

  prepare(sql: string): StatementAdapter {
    return {
      run: (...params: any[]) => {
        try {
          this.db.run(sql, params)

          // Get last insert rowid and changes
          const lastInsertRowid =
            (this.db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number) || 0
          const changes = this.db.getRowsModified()

          // Persist mutations (debounced)
          this.markDirty()

          return { changes, lastInsertRowid }
        } catch (error) {
          throw new DatabaseError(`SQL execution failed: ${sql}`, error as Error)
        }
      },
      get: (...params: any[]) => {
        try {
          const stmt = this.db.prepare(sql)
          stmt.bind(params)

          if (stmt.step()) {
            const columns = stmt.getColumnNames()
            const values = stmt.get()
            const row: any = {}

            columns.forEach((col, idx) => {
              row[col] = values[idx]
            })

            stmt.free()
            return row
          }

          stmt.free()
          return undefined
        } catch (error) {
          throw new DatabaseError(`SQL query failed: ${sql}`, error as Error)
        }
      },
      all: (...params: any[]) => {
        try {
          const stmt = this.db.prepare(sql)
          stmt.bind(params)

          const rows: any[] = []
          const columns = stmt.getColumnNames()

          while (stmt.step()) {
            const values = stmt.get()
            const row: any = {}

            columns.forEach((col, idx) => {
              row[col] = values[idx]
            })

            rows.push(row)
          }

          stmt.free()
          return rows
        } catch (error) {
          throw new DatabaseError(`SQL query failed: ${sql}`, error as Error)
        }
      },
    }
  }

  exec(sql: string): void {
    try {
      this.db.exec(sql)
      // Persist mutations (debounced)
      this.markDirty()
    } catch (error) {
      throw new DatabaseError(`SQL exec failed: ${sql}`, error as Error)
    }
  }

  close(): void {
    this.flush(true)
    this.db.close()
  }

  export(): Uint8Array {
    return this.db.export()
  }

  private markDirty(): void {
    if (this.flushIntervalMs === 0) {
      this.saveNow()
      return
    }

    this.dirty = true

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(false), this.flushIntervalMs)
    }

    // Ensure we don't defer persistence forever under heavy write load.
    if (this.lastFlushAtMs && Date.now() - this.lastFlushAtMs >= this.maxFlushIntervalMs) {
      this.flush(false)
    }
  }

  private flush(force: boolean): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (!force && !this.dirty) return
    if (!this.dirty) return

    this.saveNow()
    this.dirty = false
    this.lastFlushAtMs = Date.now()
  }

  private saveNow(): void {
    try {
      const data = this.db.export()
      writeFileSync(this.dbPath, data)
    } catch (error) {
      logger.error("Failed to save database", error as Error)
    }
  }

  // Passthrough for raw database access (needed by analytics and migrations)
  getRaw(): SqlJsDatabase {
    return this.db
  }
}

export interface SessionContext {
  id: number
  session_id: string
  context_type: string
  key: string
  value: string
  metadata?: string
  created_at: string
  updated_at: string
}

export interface UserPreference {
  id: number
  user_id: string
  category: string
  preference_key: string
  preference_value: string
  confidence: number
  occurrences: number
  created_at: string
  updated_at: string
}

export interface ProjectConvention {
  id: number
  project_id: string
  language: string
  convention_type: string
  convention_key: string
  convention_value: string
  created_at: string
  updated_at: string
}

export interface Interaction {
  id: number
  session_id: string
  role: string
  content: string
  metadata?: string
  created_at: string
}

export interface ProjectProfile {
  id: string
  name: string
  root_path?: string
  primary_language?: string
  frameworks?: string
  stack_info?: string
  conventions_summary?: string
  metadata?: string
  memory_count: number
  last_accessed?: string
  created_at: string
  updated_at: string
}

export interface EnhancedTask {
  id: number
  title: string
  description?: string
  payload_json: string
  priority: number
  state: string
  agent_id?: string
  workflow_id?: string
  parent_task_id?: number
  project_id?: string
  phase?: string
  progress: number
  estimated_hours?: number
  actual_hours?: number
  tags?: string
  created_at: string
  started_at?: string
  finished_at?: string
  error_text?: string
}

export interface RoutingPattern {
  id: number
  pattern_key: string
  agent_name: string
  confidence: number
  file_count: number
  loc_estimate: number
  success_count: number
  failure_count: number
  metadata?: string
  created_at: string
  updated_at: string
}

export interface ApiSpec {
  id: number
  spec_id: string
  title: string
  version: string
  spec_json: string
  spec_hash: string
  source?: string
  source_type: string
  last_synced: string
  created_at: string
  updated_at: string
}

export interface ApiEndpoint {
  id: number
  spec_id: string
  path: string
  method: string
  operation_id?: string
  summary?: string
  description?: string
  tags?: string
  is_deprecated: boolean
  request_body?: string
  responses?: string
  created_at: string
}

export interface ApiSchema {
  id: number
  spec_id: string
  schema_name: string
  schema_json: string
  created_at: string
}

export interface FeathersService {
  id: number
  spec_id: string
  service_name: string
  service_path: string
  methods: string
  hooks?: string
  events?: string
  source_file?: string
  created_at: string
}

export class SessionDatabase {
  private db!: SqlJsAdapter // Initialized in init()
  private analytics!: AnalyticsEngine // Initialized in init()
  private initialized: boolean = false
  private initPromise: Promise<void> | null = null
  private dbPath: string

  constructor(dbPath: string = "~/.agents/memory/session.db") {
    this.dbPath = dbPath
  }

  /**
   * Initialize the database (must be called before using the database)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this.init(this.dbPath)
    await this.initPromise
  }

  private async init(dbPath: string): Promise<void> {
    if (this.initialized) return

    try {
      if (dbPath.startsWith("~/")) {
        dbPath = dbPath.replace("~", process.env.HOME || process.env.USERPROFILE || "")
      }

      mkdirSync(dirname(dbPath), { recursive: true })

      // Initialize sql.js
      const SqlJs = await initializeSqlJs()

      // Load existing database or create new one
      let db: SqlJsDatabase
      if (existsSync(dbPath)) {
        const buffer = readFileSync(dbPath)
        db = new SqlJs.Database(buffer)
        logger.info("Loaded existing database", { dbPath })
      } else {
        db = new SqlJs.Database()
        logger.info("Created new database", { dbPath })
      }

      this.db = new SqlJsAdapter(db, dbPath)

      this.initializeTables()
      // Run migrations against the adapter (better-sqlite3 compatible interface)
      // so migrations can use prepare().get/run and exec() consistently.
      migrator.migrate(this.db)
      this.repairUnavailableFtsTriggers()
      this.analytics = new AnalyticsEngine(this.db.getRaw())
      this.setupCleanupJob()

      this.initialized = true
      logger.info("SessionDatabase initialized with sql.js", { dbPath })
    } catch (error) {
      const originalMessage = error instanceof Error ? error.message : String(error)
      const dbError = new DatabaseError(
        `Failed to initialize database: ${originalMessage}`,
        error as Error
      )
      logger.error("Database initialization failed", dbError)
      throw dbError
    }
  }

  // Helper to ensure database is initialized
  getAnalytics(): AnalyticsEngine {
    return this.analytics
  }

  getRawDb(): SqlJsDatabase {
    return this.db.getRaw()
  }

  transaction<T>(fn: () => T): T {
    const end = performanceTracker.start("transaction")
    try {
      // sql.js supports explicit transactions; use them for atomicity and speed.
      const raw = this.db.getRaw()
      raw.prepare("BEGIN").run()
      let result: T
      try {
        result = fn()
        raw.prepare("COMMIT").run()
      } catch (error) {
        raw.prepare("ROLLBACK").run()
        throw error
      }

      end()
      logger.debug("Transaction completed")

      return result
    } catch (error) {
      const dbError =
        error instanceof DatabaseError
          ? error
          : new DatabaseError("Transaction failed", error as Error)
      logger.error("Transaction failed", dbError)
      throw dbError
    }
  }

  // Security enhancement: Input sanitization
  // Note: We use parameterized queries which handle SQL injection protection.
  // This method only validates input type and trims whitespace.
  // Character stripping is NOT performed as it corrupts legitimate data.
  private sanitizeInput(input: string): string {
    if (typeof input !== "string") {
      throw new ValidationError("Input must be a string")
    }
    // Parameterized queries handle SQL injection; only validate and trim
    return input.trim()
  }

  private safeJsonParse(jsonString: string): any {
    try {
      return JSON.parse(jsonString)
    } catch (error) {
      logger.debug("Failed to parse JSON", {
        error: error instanceof Error ? error.message : "Unknown error",
      })
      return null
    }
  }

  // Security enhancement: Validate confidence values
  private validateConfidence(confidence: number): void {
    if (typeof confidence !== "number" || isNaN(confidence)) {
      throw new ValidationError("Confidence must be a valid number")
    }
    if (confidence < 0 || confidence > 1) {
      throw new ValidationError("Confidence must be between 0.0 and 1.0")
    }
  }

  // Security enhancement: Validate required string inputs
  private validateRequiredString(value: string, fieldName: string): void {
    if (!value || typeof value !== "string" || !value.trim()) {
      throw new ValidationError(`${fieldName} is required and must be a non-empty string`)
    }
  }

  private initializeTables(): void {
    // Session contexts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        context_type TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, context_type, key)
      )
    `)

    // Indexes for common access patterns
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_contexts_session_id ON session_contexts(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_contexts_updated_at ON session_contexts(updated_at);
    `)

    // User preferences table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        preference_key TEXT NOT NULL,
        preference_value TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        occurrences INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, preference_key)
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_preferences_user_category ON user_preferences(user_id, category);
    `)

    // Project conventions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_conventions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        language TEXT NOT NULL,
        convention_type TEXT NOT NULL,
        convention_key TEXT NOT NULL,
        convention_value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, language, convention_type, convention_key)
      )
    `)

    // Interactions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_interactions_session_created ON interactions(session_id, created_at);
    `)

    // Task tracking tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        title         TEXT NOT NULL,
        description   TEXT,
        payload_json  TEXT NOT NULL,
        priority      INTEGER NOT NULL DEFAULT 100,
        state         TEXT NOT NULL CHECK (state IN ('queued','in_progress','done','failed','blocked')) DEFAULT 'queued',
        agent_id      TEXT,
        workflow_id   TEXT,
        parent_task_id INTEGER,
        project_id    TEXT,
        phase         TEXT,
        progress      INTEGER DEFAULT 0,
        estimated_hours REAL,
        actual_hours  REAL,
        tags          TEXT,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        started_at    TEXT,
        finished_at   TEXT,
        error_text    TEXT,
        FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS task_agent_checks (
        task_id     INTEGER NOT NULL,
        agent_id    TEXT NOT NULL,
        role        TEXT,
        status      TEXT NOT NULL CHECK (status IN ('pending','done')) DEFAULT 'pending',
        checked_at  TEXT,
        notes       TEXT,
        PRIMARY KEY (task_id, agent_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id           INTEGER NOT NULL,
        depends_on_task_id INTEGER NOT NULL,
        dependency_type   TEXT NOT NULL DEFAULT 'blocks',
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (task_id, depends_on_task_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS task_metadata (
        task_id     INTEGER NOT NULL,
        key         TEXT NOT NULL,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (task_id, key),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
    `)

    // Operational memory tables used by daily_briefing / weekly_review / stale_work_scan.
    // Keep these in base initialization so older databases self-heal even if a migration
    // was skipped before these tools are called.
    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS artifact_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_path TEXT NOT NULL,
        artifact_type TEXT,
        project_id TEXT,
        session_id TEXT,
        harness TEXT,
        query TEXT,
        score REAL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE IF NOT EXISTS autodream_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        project TEXT,
        topic TEXT,
        mode TEXT NOT NULL DEFAULT 'report',
        schema_version INTEGER NOT NULL DEFAULT 2,
        total_rows_analyzed INTEGER,
        high_signal_count INTEGER,
        mean_score REAL,
        max_score REAL,
        bucket_decisions INTEGER DEFAULT 0,
        bucket_blockers INTEGER DEFAULT 0,
        bucket_next_actions INTEGER DEFAULT 0,
        bucket_learnings INTEGER DEFAULT 0,
        artifacts_created INTEGER DEFAULT 0,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, priority);
      CREATE INDEX IF NOT EXISTS idx_operational_tasks_status ON operational_tasks(status, priority);
      CREATE INDEX IF NOT EXISTS idx_operational_tasks_due ON operational_tasks(due_at);
      CREATE INDEX IF NOT EXISTS idx_operational_tasks_resurface ON operational_tasks(resurfacing_score DESC);
      CREATE INDEX IF NOT EXISTS idx_open_loops_last_seen ON open_loops(last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);
      CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, status);
    `)

    // artifact_reads and autodream_runs indexes depend on the updated schema from migration v12.
    // Wrap in try/catch so old-schema DBs don't crash here; migration v12 recreates the table.
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_artifact_reads_path ON artifact_reads(artifact_path, created_at);
        CREATE INDEX IF NOT EXISTS idx_artifact_reads_project ON artifact_reads(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_artifact_reads_session ON artifact_reads(session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_autodream_runs_session ON autodream_runs(session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_autodream_runs_project ON autodream_runs(project, created_at);
      `)
    } catch (_err) {
      logger.info(
        "Deferred artifact_reads/autodream_runs indexes to migration v12 (old schema detected)"
      )
    }

    // Routing patterns table
    this.db.exec(`
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
        UNIQUE(pattern_key, agent_name)
      )
    `)

    // Project profiles table
    this.db.exec(`
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
      )
    `)

    // API specifications table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_specs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spec_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        version TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        spec_hash TEXT NOT NULL,
        source TEXT,
        source_type TEXT NOT NULL,
        last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // API endpoints table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spec_id TEXT NOT NULL,
        path TEXT NOT NULL,
        method TEXT NOT NULL,
        operation_id TEXT,
        summary TEXT,
        description TEXT,
        tags TEXT,
        is_deprecated INTEGER DEFAULT 0,
        request_body TEXT,
        responses TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (spec_id) REFERENCES api_specs(spec_id) ON DELETE CASCADE,
        UNIQUE(spec_id, path, method)
      )
    `)

    // API schemas table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_schemas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spec_id TEXT NOT NULL,
        schema_name TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (spec_id) REFERENCES api_specs(spec_id) ON DELETE CASCADE,
        UNIQUE(spec_id, schema_name)
      )
    `)

    // FeathersJS services table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spec_id TEXT NOT NULL,
        service_name TEXT NOT NULL,
        service_path TEXT NOT NULL,
        methods TEXT NOT NULL,
        hooks TEXT,
        events TEXT,
        source_file TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (spec_id) REFERENCES api_specs(spec_id) ON DELETE CASCADE,
        UNIQUE(spec_id, service_path)
      )
    `)

    // Create indexes for API tables
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_api_endpoints_spec_id ON api_endpoints(spec_id);
      CREATE INDEX IF NOT EXISTS idx_api_endpoints_path ON api_endpoints(path);
      CREATE INDEX IF NOT EXISTS idx_api_endpoints_method ON api_endpoints(method);
      CREATE INDEX IF NOT EXISTS idx_api_endpoints_tags ON api_endpoints(tags);
      CREATE INDEX IF NOT EXISTS idx_api_schemas_spec_id ON api_schemas(spec_id);
      CREATE INDEX IF NOT EXISTS idx_api_services_spec_id ON api_services(spec_id);
    `)

    // Try to create FTS5 virtual table (may not be available in sql.js)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS api_endpoints_fts USING fts5(
          spec_id,
          path,
          method,
          summary,
          description,
          tags,
          content='api_endpoints',
          content_rowid='id'
        )
      `)

      // Create triggers to keep FTS5 table in sync
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS api_endpoints_fts_insert AFTER INSERT ON api_endpoints BEGIN
          INSERT INTO api_endpoints_fts(rowid, spec_id, path, method, summary, description, tags)
          VALUES (new.id, new.spec_id, new.path, new.method, new.summary, new.description, new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS api_endpoints_fts_delete AFTER DELETE ON api_endpoints BEGIN
          DELETE FROM api_endpoints_fts WHERE rowid = old.id;
        END;

        CREATE TRIGGER IF NOT EXISTS api_endpoints_fts_update AFTER UPDATE ON api_endpoints BEGIN
          DELETE FROM api_endpoints_fts WHERE rowid = old.id;
          INSERT INTO api_endpoints_fts(rowid, spec_id, path, method, summary, description, tags)
          VALUES (new.id, new.spec_id, new.path, new.method, new.summary, new.description, new.tags);
        END;
      `)

      logger.info("FTS5 full-text search enabled for API endpoints")
    } catch (error) {
      logger.warn("FTS5 not available, full-text search will use LIKE queries", error as Error)
    }

    logger.info("Database tables initialized")
  }

  private repairUnavailableFtsTriggers(): void {
    const ftsMappings = [
      {
        ftsTable: "session_contexts_fts",
        triggerNames: ["session_contexts_ai", "session_contexts_ad", "session_contexts_au"],
      },
      {
        ftsTable: "api_endpoints_fts",
        triggerNames: [
          "api_endpoints_fts_insert",
          "api_endpoints_fts_delete",
          "api_endpoints_fts_update",
        ],
      },
    ]

    for (const mapping of ftsMappings) {
      if (this.isFtsTableUsable(mapping.ftsTable)) {
        continue
      }

      for (const triggerName of mapping.triggerNames) {
        this.db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`)
      }

      logger.warn("Dropped stale FTS triggers because FTS table is unavailable", {
        ftsTable: mapping.ftsTable,
        triggerNames: mapping.triggerNames,
      })
    }
  }

  private isFtsTableUsable(tableName: string): boolean {
    const tableExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tableName)

    if (!tableExists) {
      return false
    }

    try {
      this.db.prepare(`SELECT rowid FROM ${tableName} LIMIT 1`).all()
      return true
    } catch {
      return false
    }
  }

  private setupCleanupJob(): void {
    const cleanupInterval = 24 * 60 * 60 * 1000 // 24 hours
    const contextTtlDays = 30
    const interactionTtlDays = 90

    const timer = setInterval(() => {
      try {
        const deletedRecords = this.cleanupOldData({
          contextDaysOld: contextTtlDays,
          interactionDaysOld: interactionTtlDays,
        })

        if (deletedRecords > 0) {
          logger.info("Cleanup job completed", {
            deletedRecords,
            contextTtlDays,
            interactionTtlDays,
          })
        }
      } catch (error) {
        logger.error("Cleanup job failed", error as Error)
      }
    }, cleanupInterval)

    // Do not keep the Node.js event loop alive just for cleanup.
    // This matters for short-lived CLI invocations that import SessionDatabase.
    if (typeof (timer as any).unref === "function") {
      ;(timer as any).unref()
    }
  }

  // Session Context Methods
  storeContext(
    sessionId: string,
    contextType: string,
    key: string,
    value: string,
    metadata?: string
  ): void {
    this.validateRequiredString(sessionId, "sessionId")
    this.validateRequiredString(contextType, "contextType")
    this.validateRequiredString(key, "key")
    this.validateRequiredString(value, "value")

    const sanitizedSessionId = this.sanitizeInput(sessionId)
    const sanitizedContextType = this.sanitizeInput(contextType)
    const sanitizedKey = this.sanitizeInput(key)
    const sanitizedValue = this.sanitizeInput(value)

    const stmt = this.db.prepare(`
      INSERT INTO session_contexts (session_id, context_type, key, value, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id, context_type, key) 
      DO UPDATE SET value = excluded.value, metadata = excluded.metadata, updated_at = CURRENT_TIMESTAMP
    `)

    stmt.run(
      sanitizedSessionId,
      sanitizedContextType,
      sanitizedKey,
      sanitizedValue,
      metadata || null
    )
    logger.debug("Context stored", {
      sessionId: sanitizedSessionId,
      contextType: sanitizedContextType,
      key: sanitizedKey,
    })
  }

  getContext(
    sessionId: string,
    contextType?: string,
    key?: string,
    limit: number = 10
  ): SessionContext[] {
    this.validateRequiredString(sessionId, "sessionId")

    const rawSessionId = sessionId.trim()
    const allSessions = rawSessionId === "*"
    const sanitizedSessionId = allSessions ? "*" : this.sanitizeInput(rawSessionId)

    let sql = `SELECT * FROM session_contexts`
    const params: any[] = []

    if (!allSessions) {
      sql += ` WHERE session_id = ?`
      params.push(sanitizedSessionId)
    } else {
      sql += ` WHERE 1=1`
    }

    if (contextType) {
      const sanitizedContextType = this.sanitizeInput(contextType)
      sql += ` AND context_type = ?`
      params.push(sanitizedContextType)
    }

    if (key) {
      const sanitizedKey = this.sanitizeInput(key)
      sql += ` AND key = ?`
      params.push(sanitizedKey)
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?`
    params.push(limit)

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as SessionContext[]
  }

  updateContext(
    sessionId: string,
    contextType: string,
    key: string,
    value: string,
    metadata?: string
  ): void {
    this.validateRequiredString(sessionId, "sessionId")
    this.validateRequiredString(contextType, "contextType")
    this.validateRequiredString(key, "key")
    this.validateRequiredString(value, "value")

    const sanitizedSessionId = this.sanitizeInput(sessionId)
    const sanitizedContextType = this.sanitizeInput(contextType)
    const sanitizedKey = this.sanitizeInput(key)
    const sanitizedValue = this.sanitizeInput(value)

    const stmt = this.db.prepare(`
      UPDATE session_contexts 
      SET value = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ? AND context_type = ? AND key = ?
    `)

    const result = stmt.run(
      sanitizedValue,
      metadata || null,
      sanitizedSessionId,
      sanitizedContextType,
      sanitizedKey
    )

    if (result.changes === 0) {
      throw new ValidationError("Context not found")
    }

    logger.debug("Context updated", {
      sessionId: sanitizedSessionId,
      contextType: sanitizedContextType,
      key: sanitizedKey,
    })
  }

  // User Preference Methods
  trackPreference(
    userId: string,
    category: string,
    preferenceKey: string,
    preferenceValue: string,
    confidence: number = 0.8
  ): void {
    this.validateRequiredString(userId, "userId")
    this.validateRequiredString(category, "category")
    this.validateRequiredString(preferenceKey, "preferenceKey")
    this.validateRequiredString(preferenceValue, "preferenceValue")
    this.validateConfidence(confidence)

    const sanitizedUserId = this.sanitizeInput(userId)
    const sanitizedCategory = this.sanitizeInput(category)
    const sanitizedPreferenceKey = this.sanitizeInput(preferenceKey)
    const sanitizedPreferenceValue = this.sanitizeInput(preferenceValue)

    const stmt = this.db.prepare(`
      INSERT INTO user_preferences (user_id, category, preference_key, preference_value, confidence, occurrences, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, preference_key) 
      DO UPDATE SET 
        preference_value = excluded.preference_value,
        confidence = MIN(1.0, confidence + 0.1),
        occurrences = occurrences + 1,
        updated_at = CURRENT_TIMESTAMP
    `)

    stmt.run(
      sanitizedUserId,
      sanitizedCategory,
      sanitizedPreferenceKey,
      sanitizedPreferenceValue,
      confidence
    )
    logger.debug("Preference tracked", {
      userId: sanitizedUserId,
      category: sanitizedCategory,
      preferenceKey: sanitizedPreferenceKey,
    })
  }

  // Deterministic upsert for bootstrapping/import.
  // Unlike trackPreference(), this does not artificially increase confidence/occurrences on repeated imports.
  setPreference(
    userId: string,
    category: string,
    preferenceKey: string,
    preferenceValue: string,
    confidence: number = 1.0
  ): void {
    this.validateRequiredString(userId, "userId")
    this.validateRequiredString(category, "category")
    this.validateRequiredString(preferenceKey, "preferenceKey")
    this.validateRequiredString(preferenceValue, "preferenceValue")
    this.validateConfidence(confidence)

    const sanitizedUserId = this.sanitizeInput(userId)
    const sanitizedCategory = this.sanitizeInput(category)
    const sanitizedPreferenceKey = this.sanitizeInput(preferenceKey)
    const sanitizedPreferenceValue = this.sanitizeInput(preferenceValue)

    const stmt = this.db.prepare(`
      INSERT INTO user_preferences (user_id, category, preference_key, preference_value, confidence, occurrences, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, preference_key)
      DO UPDATE SET
        category = excluded.category,
        preference_value = excluded.preference_value,
        confidence = excluded.confidence,
        updated_at = CURRENT_TIMESTAMP
    `)

    stmt.run(
      sanitizedUserId,
      sanitizedCategory,
      sanitizedPreferenceKey,
      sanitizedPreferenceValue,
      confidence
    )
  }

  getPreferences(userId: string, category?: string, minConfidence: number = 0.0): UserPreference[] {
    this.validateRequiredString(userId, "userId")
    const sanitizedUserId = this.sanitizeInput(userId)

    let sql = `SELECT * FROM user_preferences WHERE user_id = ? AND confidence >= ?`
    const params: any[] = [sanitizedUserId, minConfidence]

    if (category) {
      const sanitizedCategory = this.sanitizeInput(category)
      sql += ` AND category = ?`
      params.push(sanitizedCategory)
    }

    sql += ` ORDER BY confidence DESC, occurrences DESC`

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as UserPreference[]
  }

  prunePreferences(
    userId: string,
    keepKeys: string[],
    dryRun: boolean = false
  ): {
    total: number
    kept: number
    deleted: number
    deletedKeys: string[]
  } {
    this.validateRequiredString(userId, "userId")
    if (!Array.isArray(keepKeys)) {
      throw new ValidationError("keepKeys must be an array")
    }

    const sanitizedUserId = this.sanitizeInput(userId)
    const keep = new Set(keepKeys.map(k => this.sanitizeInput(String(k))))

    const rows = this.db
      .prepare(`SELECT preference_key FROM user_preferences WHERE user_id = ?`)
      .all(sanitizedUserId) as { preference_key: string }[]

    const total = rows.length
    const deletedKeys = rows.map(r => String(r.preference_key)).filter(k => !keep.has(k))

    const kept = total - deletedKeys.length

    if (dryRun || deletedKeys.length === 0) {
      return { total, kept, deleted: 0, deletedKeys }
    }

    const deleted = this.transaction(() => {
      let changes = 0

      // Chunk deletes to avoid oversized SQL statements.
      const chunkSize = 100
      for (let i = 0; i < deletedKeys.length; i += chunkSize) {
        const chunk = deletedKeys.slice(i, i + chunkSize)
        const placeholders = chunk.map(() => "?").join(",")
        const stmt = this.db.prepare(
          `DELETE FROM user_preferences WHERE user_id = ? AND preference_key IN (${placeholders})`
        )
        const result = stmt.run(sanitizedUserId, ...chunk)
        changes += result.changes || 0
      }

      return changes
    })

    return { total, kept, deleted, deletedKeys }
  }

  // Project Convention Methods
  storeConvention(
    projectId: string,
    language: string,
    conventionType: string,
    conventionKey: string,
    conventionValue: string
  ): void {
    this.validateRequiredString(projectId, "projectId")
    this.validateRequiredString(language, "language")
    this.validateRequiredString(conventionType, "conventionType")
    this.validateRequiredString(conventionKey, "conventionKey")
    this.validateRequiredString(conventionValue, "conventionValue")

    const sanitizedProjectId = this.sanitizeInput(projectId)
    const sanitizedLanguage = this.sanitizeInput(language)
    const sanitizedConventionType = this.sanitizeInput(conventionType)
    const sanitizedConventionKey = this.sanitizeInput(conventionKey)
    const sanitizedConventionValue = this.sanitizeInput(conventionValue)

    const stmt = this.db.prepare(`
      INSERT INTO project_conventions (project_id, language, convention_type, convention_key, convention_value, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project_id, language, convention_type, convention_key) 
      DO UPDATE SET convention_value = excluded.convention_value, updated_at = CURRENT_TIMESTAMP
    `)

    stmt.run(
      sanitizedProjectId,
      sanitizedLanguage,
      sanitizedConventionType,
      sanitizedConventionKey,
      sanitizedConventionValue
    )
    logger.debug("Convention stored", {
      projectId: sanitizedProjectId,
      language: sanitizedLanguage,
      conventionType: sanitizedConventionType,
    })
  }

  getConventions(
    projectId: string,
    language?: string,
    conventionType?: string
  ): ProjectConvention[] {
    this.validateRequiredString(projectId, "projectId")
    const sanitizedProjectId = this.sanitizeInput(projectId)

    let sql = `SELECT * FROM project_conventions WHERE project_id = ?`
    const params: any[] = [sanitizedProjectId]

    if (language) {
      const sanitizedLanguage = this.sanitizeInput(language)
      sql += ` AND language = ?`
      params.push(sanitizedLanguage)
    }

    if (conventionType) {
      const sanitizedConventionType = this.sanitizeInput(conventionType)
      sql += ` AND convention_type = ?`
      params.push(sanitizedConventionType)
    }

    sql += ` ORDER BY updated_at DESC`

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as ProjectConvention[]
  }

  // Interaction Methods
  storeInteraction(sessionId: string, role: string, content: string, metadata?: string): void {
    this.validateRequiredString(sessionId, "sessionId")
    this.validateRequiredString(role, "role")
    this.validateRequiredString(content, "content")

    const sanitizedSessionId = this.sanitizeInput(sessionId)
    const sanitizedRole = this.sanitizeInput(role)
    const sanitizedContent = this.sanitizeInput(content)

    const stmt = this.db.prepare(`
      INSERT INTO interactions (session_id, role, content, metadata)
      VALUES (?, ?, ?, ?)
    `)

    stmt.run(sanitizedSessionId, sanitizedRole, sanitizedContent, metadata || null)
    logger.debug("Interaction stored", { sessionId: sanitizedSessionId, role: sanitizedRole })
  }

  getInteractions(sessionId: string, limit: number = 10): Interaction[] {
    this.validateRequiredString(sessionId, "sessionId")
    const sanitizedSessionId = this.sanitizeInput(sessionId)

    const stmt = this.db.prepare(`
      SELECT * FROM interactions 
      WHERE session_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `)

    return stmt.all(sanitizedSessionId, limit) as Interaction[]
  }

  // Task Management Methods
  createTask(
    title: string,
    description: string,
    payloadJson: string,
    priority: number = 100,
    workflowId?: string,
    parentTaskId?: number,
    projectId?: string,
    phase?: string,
    estimatedHours?: number,
    tags?: string
  ): number {
    this.validateRequiredString(title, "title")
    this.validateRequiredString(payloadJson, "payloadJson")

    const sanitizedTitle = this.sanitizeInput(title)
    const sanitizedDescription = description ? this.sanitizeInput(description) : null

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        title, description, payload_json, priority, workflow_id, parent_task_id,
        project_id, phase, progress, estimated_hours, tags
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `)

    const result = stmt.run(
      sanitizedTitle,
      sanitizedDescription,
      payloadJson,
      priority,
      workflowId || null,
      parentTaskId || null,
      projectId || null,
      phase || null,
      estimatedHours || null,
      tags || null
    )

    logger.debug("Task created", { taskId: result.lastInsertRowid, title: sanitizedTitle })
    return result.lastInsertRowid
  }

  getTask(taskId: number): EnhancedTask | undefined {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`)
    return stmt.get(taskId) as EnhancedTask | undefined
  }

  getTasks(
    filters: {
      state?: string
      workflowId?: string
      agentId?: string
      parentTaskId?: number
      projectId?: string
      phase?: string
      limit?: number
    } = {}
  ): EnhancedTask[] {
    let sql = `SELECT * FROM tasks WHERE 1=1`
    const params: any[] = []

    if (filters.state) {
      sql += ` AND state = ?`
      params.push(filters.state)
    }

    if (filters.workflowId) {
      sql += ` AND workflow_id = ?`
      params.push(filters.workflowId)
    }

    if (filters.agentId) {
      sql += ` AND agent_id = ?`
      params.push(filters.agentId)
    }

    if (filters.parentTaskId !== undefined) {
      sql += ` AND parent_task_id = ?`
      params.push(filters.parentTaskId)
    }

    if (filters.projectId) {
      sql += ` AND project_id = ?`
      params.push(filters.projectId)
    }

    if (filters.phase) {
      sql += ` AND phase = ?`
      params.push(filters.phase)
    }

    sql += ` ORDER BY priority DESC, created_at ASC`

    if (filters.limit) {
      sql += ` LIMIT ?`
      params.push(filters.limit)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as EnhancedTask[]
  }

  updateTaskState(taskId: number, state: string, errorText?: string, routingPatternKey?: string): void {
    const stmt = this.db.prepare(`
      UPDATE tasks 
      SET state = ?,
          error_text = ?,
          started_at = CASE WHEN state = 'queued' AND ? = 'in_progress' THEN datetime('now') ELSE started_at END,
          finished_at = CASE WHEN ? IN ('done', 'failed', 'blocked') THEN datetime('now') ELSE finished_at END
      WHERE id = ?
    `)

    stmt.run(state, errorText || null, state, state, taskId)
    logger.debug("Task state updated", { taskId, state })

    // Auto-update routing pattern success/failure based on task completion
    if (routingPatternKey && state === "done") {
      this.incrementRoutingPatternSuccess(routingPatternKey)
    } else if (routingPatternKey && state === "failed") {
      this.incrementRoutingPatternFailure(routingPatternKey)
    }
  }

  // Increment routing pattern success count
  incrementRoutingPatternSuccess(patternKey: string): void {
    const stmt = this.db.prepare(`
      UPDATE routing_patterns 
      SET success_count = success_count + 1, 
          confidence = MIN(1.0, (success_count + 1.0) / NULLIF(success_count + failure_count + 1, 0)),
          updated_at = CURRENT_TIMESTAMP
      WHERE pattern_key = ?
    `)
    stmt.run(patternKey)
  }

  // Increment routing pattern failure count
  incrementRoutingPatternFailure(patternKey: string): void {
    const stmt = this.db.prepare(`
      UPDATE routing_patterns 
      SET failure_count = failure_count + 1, 
          confidence = MAX(0.1, (success_count) / NULLIF(success_count + failure_count + 1, 0)),
          updated_at = CURRENT_TIMESTAMP
      WHERE pattern_key = ?
    `)
    stmt.run(patternKey)
  }

  // Routing Pattern Methods
  storeRoutingPattern(
    patternKey: string,
    agentName: string,
    confidence: number,
    fileCount: number,
    locEstimate: number,
    metadata?: string
  ): void {
    this.validateRequiredString(patternKey, "patternKey")
    this.validateRequiredString(agentName, "agentName")
    this.validateConfidence(confidence)

    const sanitizedPatternKey = this.sanitizeInput(patternKey)
    const sanitizedAgentName = this.sanitizeInput(agentName)

    const stmt = this.db.prepare(`
      INSERT INTO routing_patterns (
        pattern_key, agent_name, confidence, file_count, loc_estimate, success_count, metadata, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(pattern_key, agent_name) 
      DO UPDATE SET 
        confidence = MIN(1.0, confidence + 0.05),
        file_count = excluded.file_count,
        loc_estimate = excluded.loc_estimate,
        success_count = success_count + 1,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `)

    stmt.run(
      sanitizedPatternKey,
      sanitizedAgentName,
      confidence,
      fileCount,
      locEstimate,
      metadata || null
    )
    logger.debug("Routing pattern stored", {
      patternKey: sanitizedPatternKey,
      agentName: sanitizedAgentName,
    })
  }

  getRoutingPatterns(minConfidence: number = 0.7, limit: number = 20): RoutingPattern[] {
    const stmt = this.db.prepare(`
      SELECT * FROM routing_patterns 
      WHERE confidence >= ? 
      ORDER BY confidence DESC, success_count DESC 
      LIMIT ?
    `)

    return stmt.all(minConfidence, limit) as RoutingPattern[]
  }

  // Per-type TTL configuration (days)
  private readonly CONTEXT_TYPE_TTL: Record<string, number> = {
    convention: Infinity, // Never expire project conventions
    decision: 90, // Keep decisions for 90 days
    workflow: 14, // Workflow state expires faster
    blocker: 7, // Blockers should be resolved quickly
    handoff: 30, // Handoffs kept for a month
    interaction: 7, // Old interactions expire fast
  }

  // Default TTL for unknown context types
  private readonly DEFAULT_CONTEXT_TTL_DAYS = 30

  // Helper to get TTL for context type
  private getContextTypeTTL(contextType: string): number {
    return this.CONTEXT_TYPE_TTL[contextType] ?? this.DEFAULT_CONTEXT_TTL_DAYS
  }

  // Enhanced cleanup with per-type TTL
  cleanupSmart(args: { preferenceDaysOld?: number; conventionDaysOld?: number } = {}): number {
    const prefDays = args.preferenceDaysOld ?? 90
    const convDays = args.conventionDaysOld ?? Infinity // Conventions never expire by default
    let total = 0

    // Clean preferences older than prefDays (but extend if recently accessed)
    const oldPrefs = this.db.prepare(`
      DELETE FROM user_preferences
      WHERE updated_at < datetime('now', '-${prefDays} days')
      AND (last_accessed IS NULL OR last_accessed < datetime('now', '-${prefDays} days'))
    `)
    total += (oldPrefs.run().changes || 0)

    // Clean conventions older than convDays (but extend if recently accessed)
    if (convDays !== Infinity) {
      const oldConvs = this.db.prepare(`
        DELETE FROM project_conventions
        WHERE updated_at < datetime('now', '-${convDays} days')
        AND (last_accessed IS NULL OR last_accessed < datetime('now', '-${convDays} days'))
      `)
      total += (oldConvs.run().changes || 0)
    }

    // Clean session contexts by type with per-type TTL
    for (const [ctxType, ttlDays] of Object.entries(this.CONTEXT_TYPE_TTL)) {
      if (ttlDays === Infinity) continue
      const deleteStmt = this.db.prepare(`
        DELETE FROM session_contexts
        WHERE context_type = ?
        AND updated_at < datetime('now', '-${ttlDays} days')
        AND (last_accessed IS NULL OR last_accessed < datetime('now', '-${ttlDays} days'))
      `)
      total += (deleteStmt.run(ctxType).changes || 0)
    }

    logger.info("Smart cleanup completed", { totalDeleted: total })
    return total
  }

  // Update last_accessed on retrieval
  touchPreference(userId: string, preferenceKey: string): void {
    const stmt = this.db.prepare(`
      UPDATE user_preferences SET last_accessed = CURRENT_TIMESTAMP
      WHERE user_id = ? AND preference_key = ?
    `)
    stmt.run(userId, preferenceKey)
  }

  touchConvention(projectId: string, conventionKey: string): void {
    const stmt = this.db.prepare(`
      UPDATE project_conventions SET last_accessed = CURRENT_TIMESTAMP
      WHERE project_id = ? AND convention_key = ?
    `)
    stmt.run(projectId, conventionKey)
  }

  touchContext(contextId: number): void {
    const stmt = this.db.prepare(`
      UPDATE session_contexts SET last_accessed = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(contextId)
  }

  // Cleanup Methods
  cleanupOldSessions(daysOld: number = 30): number {
    const modifier = `-${daysOld} days`

    const deleteContexts = this.db.prepare(`
      DELETE FROM session_contexts
      WHERE updated_at < datetime('now', ?)
    `)

    const deleteInteractions = this.db.prepare(`
      DELETE FROM interactions
      WHERE created_at < datetime('now', ?)
    `)

    const ctxResult = deleteContexts.run(modifier)
    const intResult = deleteInteractions.run(modifier)
    const total = (ctxResult.changes || 0) + (intResult.changes || 0)

    logger.info("Old session data cleaned up", {
      daysOld,
      deletedContexts: ctxResult.changes,
      deletedInteractions: intResult.changes,
      totalDeleted: total,
    })

    return total
  }

  cleanupOldData(args: { contextDaysOld: number; interactionDaysOld: number }): number {
    const ctxModifier = `-${args.contextDaysOld} days`
    const intModifier = `-${args.interactionDaysOld} days`

    const deleteContexts = this.db.prepare(`
      DELETE FROM session_contexts
      WHERE updated_at < datetime('now', ?)
    `)

    const deleteInteractions = this.db.prepare(`
      DELETE FROM interactions
      WHERE created_at < datetime('now', ?)
    `)

    const ctxResult = deleteContexts.run(ctxModifier)
    const intResult = deleteInteractions.run(intModifier)
    const total = (ctxResult.changes || 0) + (intResult.changes || 0)

    logger.info("Old data cleaned up", {
      contextDaysOld: args.contextDaysOld,
      interactionDaysOld: args.interactionDaysOld,
      deletedContexts: ctxResult.changes,
      deletedInteractions: intResult.changes,
      totalDeleted: total,
    })

    return total
  }

  // Stats Methods
  getStats(): any {
    const stats = {
      sessions: this.db
        .prepare(`SELECT COUNT(DISTINCT session_id) as count FROM session_contexts`)
        .get(),
      contexts: this.db.prepare(`SELECT COUNT(*) as count FROM session_contexts`).get(),
      preferences: this.db.prepare(`SELECT COUNT(*) as count FROM user_preferences`).get(),
      conventions: this.db.prepare(`SELECT COUNT(*) as count FROM project_conventions`).get(),
      interactions: this.db.prepare(`SELECT COUNT(*) as count FROM interactions`).get(),
      tasks: this.db.prepare(`SELECT COUNT(*) as count FROM tasks`).get(),
      routingPatterns: this.db.prepare(`SELECT COUNT(*) as count FROM routing_patterns`).get(),
      artifactReads: this.db.prepare(`SELECT COUNT(*) as count FROM artifact_reads`).get(),
      autodreamRuns: this.db.prepare(`SELECT COUNT(*) as count FROM autodream_runs`).get(),
    }

    return stats
  }

  getIntegrityStatus(): { ok: boolean; result: string[] } {
    try {
      const row = this.db.prepare(`PRAGMA integrity_check`).get() as
        | Record<string, unknown>
        | undefined
      const firstValue = row ? Object.values(row)[0] : undefined
      const result = firstValue === undefined ? [] : [String(firstValue)]
      return {
        ok: result.length > 0 && result.every(entry => entry.toLowerCase() === "ok"),
        result,
      }
    } catch (error) {
      logger.error("Integrity check failed", error as Error)
      return {
        ok: false,
        result: [(error as Error).message],
      }
    }
  }

  recordArtifactRead(input: {
    artifactPath: string
    artifactType?: string
    projectId?: string
    sessionId?: string
    harness?: string
    query?: string
    score?: number
    metadata?: string
  }): number {
    this.validateRequiredString(input.artifactPath, "artifactPath")

    const stmt = this.db.prepare(`
      INSERT INTO artifact_reads (
        artifact_path,
        artifact_type,
        project_id,
        session_id,
        harness,
        query,
        score,
        metadata,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `)

    stmt.run(
      this.sanitizeInput(input.artifactPath),
      input.artifactType ? this.sanitizeInput(input.artifactType) : null,
      input.projectId ? this.sanitizeInput(input.projectId) : null,
      input.sessionId ? this.sanitizeInput(input.sessionId) : null,
      input.harness ? this.sanitizeInput(input.harness) : null,
      input.query ? this.sanitizeInput(input.query) : null,
      typeof input.score === "number" ? input.score : null,
      input.metadata || null
    )

    const idRow = this.db.prepare(`SELECT last_insert_rowid() AS id`).get() as
      | { id?: number }
      | undefined
    const insertedId = Number(idRow?.id ?? 0)
    logger.debug("Artifact read recorded", { artifactPath: input.artifactPath, insertedId })
    return insertedId
  }

  getArtifactReads(filters: {
    projectId?: string
    sessionId?: string
    harness?: string
    artifactPath?: string
    limit?: number
  }): any[] {
    let sql = `SELECT * FROM artifact_reads WHERE 1=1`
    const params: any[] = []

    if (filters.projectId) {
      sql += ` AND project_id = ?`
      params.push(this.sanitizeInput(filters.projectId))
    }
    if (filters.sessionId) {
      sql += ` AND session_id = ?`
      params.push(this.sanitizeInput(filters.sessionId))
    }
    if (filters.harness) {
      sql += ` AND harness = ?`
      params.push(this.sanitizeInput(filters.harness))
    }
    if (filters.artifactPath) {
      sql += ` AND artifact_path = ?`
      params.push(this.sanitizeInput(filters.artifactPath))
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`
    params.push(filters.limit || 20)

    return this.db.prepare(sql).all(...params)
  }

  getAutodreamMetrics(filters: { project?: string; sessionId?: string; limit?: number }): any[] {
    let sql = `SELECT * FROM autodream_runs WHERE 1=1`
    const params: any[] = []

    if (filters.project) {
      sql += ` AND project = ?`
      params.push(this.sanitizeInput(filters.project))
    }
    if (filters.sessionId) {
      sql += ` AND session_id = ?`
      params.push(this.sanitizeInput(filters.sessionId))
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`
    params.push(filters.limit || 20)

    return this.db.prepare(sql).all(...params)
  }

  // Method aliases for backward compatibility
  retrieveContext = this.getContext
  learnConvention = this.storeConvention
  getInteractionHistory = this.getInteractions

  // Task Management - Update Task
  updateTask(
    taskId: number,
    updates: {
      title?: string
      description?: string
      state?: string
      priority?: number
      progress?: number
      errorText?: string
      estimatedHours?: number
      actualHours?: number
      tags?: string
      agentId?: string
    }
  ): void {
    const fields: string[] = []
    const params: any[] = []

    if (updates.title !== undefined) {
      fields.push("title = ?")
      params.push(this.sanitizeInput(updates.title))
    }

    if (updates.description !== undefined) {
      fields.push("description = ?")
      params.push(updates.description ? this.sanitizeInput(updates.description) : null)
    }

    if (updates.priority !== undefined) {
      fields.push("priority = ?")
      params.push(updates.priority)
    }

    if (updates.state !== undefined) {
      fields.push("state = ?")
      params.push(updates.state)

      // Auto-set timestamps based on state transitions
      if (updates.state === "in_progress") {
        fields.push(
          "started_at = CASE WHEN started_at IS NULL THEN datetime('now') ELSE started_at END"
        )
      } else if (["done", "failed", "blocked"].includes(updates.state)) {
        fields.push("finished_at = datetime('now')")
      }
    }

    if (updates.progress !== undefined) {
      fields.push("progress = ?")
      params.push(updates.progress)
    }

    if (updates.errorText !== undefined) {
      fields.push("error_text = ?")
      params.push(updates.errorText)
    }

    if (updates.estimatedHours !== undefined) {
      fields.push("estimated_hours = ?")
      params.push(updates.estimatedHours)
    }

    if (updates.actualHours !== undefined) {
      fields.push("actual_hours = ?")
      params.push(updates.actualHours)
    }

    if (updates.tags !== undefined) {
      fields.push("tags = ?")
      params.push(updates.tags)
    }

    if (updates.agentId !== undefined) {
      fields.push("agent_id = ?")
      params.push(updates.agentId)
    }

    if (fields.length === 0) {
      throw new ValidationError("No fields to update")
    }

    params.push(taskId)
    const sql = `UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`
    const stmt = this.db.prepare(sql)
    const result = stmt.run(...params)

    if (result.changes === 0) {
      throw new ValidationError("Task not found")
    }

    logger.debug("Task updated", { taskId, updates })
  }

  // Task Management - Delete Task
  deleteTask(taskId: number): boolean {
    const stmt = this.db.prepare(`DELETE FROM tasks WHERE id = ?`)
    const result = stmt.run(taskId)

    if (result.changes > 0) {
      logger.debug("Task deleted", { taskId })
      return true
    }

    return false
  }

  // Task Management - Get Task Board (Kanban View)
  getTaskBoard(
    filters: {
      projectId?: string
      includeDone?: boolean
    } = {}
  ): {
    backlog: EnhancedTask[]
    in_progress: EnhancedTask[]
    done: EnhancedTask[]
    blocked: EnhancedTask[]
    failed: EnhancedTask[]
  } {
    let sql = `SELECT * FROM tasks WHERE 1=1`
    const params: any[] = []

    if (filters.projectId) {
      sql += ` AND project_id = ?`
      params.push(filters.projectId)
    }

    if (!filters.includeDone) {
      sql += ` AND state NOT IN ('done', 'failed')`
    }

    sql += ` ORDER BY priority DESC, created_at ASC`

    const stmt = this.db.prepare(sql)
    const allTasks = stmt.all(...params) as EnhancedTask[]

    // Group by state
    const board = {
      backlog: allTasks.filter(t => t.state === "queued"),
      in_progress: allTasks.filter(t => t.state === "in_progress"),
      done: allTasks.filter(t => t.state === "done"),
      blocked: allTasks.filter(t => t.state === "blocked"),
      failed: allTasks.filter(t => t.state === "failed"),
    }

    return board
  }

  // Task Management - Get Task Insights
  getTaskInsights(
    filters: {
      projectId?: string
    } = {}
  ): {
    total: number
    byState: Record<string, number>
    byPhase: Record<string, number>
    avgCompletionTime?: number
    totalEstimatedHours?: number
    totalActualHours?: number
  } {
    let whereClause = "WHERE 1=1"
    const params: any[] = []

    if (filters.projectId) {
      whereClause += " AND project_id = ?"
      params.push(filters.projectId)
    }

    // Total tasks
    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM tasks ${whereClause}`)
    const total = (totalStmt.get(...params) as any).count

    // By state
    const byStateStmt = this.db.prepare(`
      SELECT state, COUNT(*) as count 
      FROM tasks ${whereClause}
      GROUP BY state
    `)
    const byStateRows = byStateStmt.all(...params) as any[]
    const byState: Record<string, number> = {}
    byStateRows.forEach(row => {
      byState[row.state] = row.count
    })

    // By phase
    const byPhaseStmt = this.db.prepare(`
      SELECT phase, COUNT(*) as count 
      FROM tasks ${whereClause} AND phase IS NOT NULL
      GROUP BY phase
    `)
    const byPhaseRows = byPhaseStmt.all(...params) as any[]
    const byPhase: Record<string, number> = {}
    byPhaseRows.forEach(row => {
      byPhase[row.phase] = row.count
    })

    // Average completion time (only for completed tasks)
    const avgTimeStmt = this.db.prepare(`
      SELECT AVG(CAST((julianday(finished_at) - julianday(started_at)) * 24 AS REAL)) as avg_hours
      FROM tasks 
      ${whereClause} AND state = 'done' AND started_at IS NOT NULL AND finished_at IS NOT NULL
    `)
    const avgTimeResult = avgTimeStmt.get(...params) as any
    const avgCompletionTime = avgTimeResult?.avg_hours || undefined

    // Total estimated and actual hours
    const hoursStmt = this.db.prepare(`
      SELECT 
        SUM(estimated_hours) as total_estimated,
        SUM(actual_hours) as total_actual
      FROM tasks ${whereClause}
    `)
    const hoursResult = hoursStmt.get(...params) as any

    return {
      total,
      byState,
      byPhase,
      avgCompletionTime,
      totalEstimatedHours: hoursResult?.total_estimated || undefined,
      totalActualHours: hoursResult?.total_actual || undefined,
    }
  }

  // Project Profile Methods
  getProjectProfile(projectId: string): ProjectProfile | undefined {
    this.validateRequiredString(projectId, "projectId")
    const sanitizedProjectId = this.sanitizeInput(projectId)

    const stmt = this.db.prepare(`SELECT * FROM project_profiles WHERE id = ?`)
    return stmt.get(sanitizedProjectId) as ProjectProfile | undefined
  }

  createProjectProfile(profile: {
    id: string
    name: string
    root_path?: string
    primary_language?: string
    frameworks?: string
    stack_info?: string
    conventions_summary?: string
    metadata?: string
  }): void {
    this.validateRequiredString(profile.id, "id")
    this.validateRequiredString(profile.name, "name")

    const stmt = this.db.prepare(`
      INSERT INTO project_profiles (
        id, name, root_path, primary_language, frameworks, stack_info,
        conventions_summary, metadata, memory_count, last_accessed
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    stmt.run(
      this.sanitizeInput(profile.id),
      this.sanitizeInput(profile.name),
      profile.root_path || null,
      profile.primary_language || null,
      profile.frameworks || null,
      profile.stack_info || null,
      profile.conventions_summary || null,
      profile.metadata || null
    )

    logger.debug("Project profile created", { projectId: profile.id })
  }

  listProjectProfiles(
    filters: {
      limit?: number
    } = {}
  ): ProjectProfile[] {
    let sql = `SELECT * FROM project_profiles ORDER BY last_accessed DESC`
    const params: any[] = []

    if (filters.limit) {
      sql += ` LIMIT ?`
      params.push(filters.limit)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as ProjectProfile[]
  }

  // Routing Pattern Methods - Find Similar
  findSimilarRoutingPatterns(
    description: string,
    options: {
      limit?: number
      minConfidence?: number
    } = {}
  ): RoutingPattern[] {
    const limit = options.limit || 5
    const minConfidence = options.minConfidence || 0.7

    // Simple keyword matching for similarity
    // In a real implementation, you'd use FTS or vector similarity
    const keywords = description
      .toLowerCase()
      .split(/\s+/)
      .filter(k => k.length > 3)

    if (keywords.length === 0) {
      return this.getRoutingPatterns(minConfidence, limit)
    }

    // Build LIKE conditions for each keyword
    const likeConditions = keywords.map(() => "pattern_key LIKE ?").join(" OR ")
    const params: any[] = keywords.map(k => `%${k}%`)
    params.push(minConfidence)
    params.push(limit)

    const sql = `
      SELECT * FROM routing_patterns 
      WHERE (${likeConditions}) AND confidence >= ?
      ORDER BY confidence DESC, success_count DESC 
      LIMIT ?
    `

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as RoutingPattern[]
  }

  // Batch Methods
  storeContextBatch(
    sessionId: string,
    contexts: Array<{
      context_type: string
      key: string
      value: string
      metadata?: string
    }>
  ): number {
    this.validateRequiredString(sessionId, "sessionId")
    const sanitizedSessionId = this.sanitizeInput(sessionId)

    let count = 0
    this.transaction(() => {
      contexts.forEach(ctx => {
        this.storeContext(sanitizedSessionId, ctx.context_type, ctx.key, ctx.value, ctx.metadata)
        count++
      })
    })

    logger.debug("Context batch stored", { sessionId: sanitizedSessionId, count })
    return count
  }

  trackPreferenceBatch(
    userId: string,
    preferences: Array<{
      category: string
      preference_key: string
      preference_value: string
      confidence?: number
    }>
  ): number {
    this.validateRequiredString(userId, "userId")
    const sanitizedUserId = this.sanitizeInput(userId)

    let count = 0
    this.transaction(() => {
      preferences.forEach(pref => {
        this.trackPreference(
          sanitizedUserId,
          pref.category,
          pref.preference_key,
          pref.preference_value,
          pref.confidence || 0.8
        )
        count++
      })
    })

    logger.debug("Preference batch tracked", { userId: sanitizedUserId, count })
    return count
  }

  storeConventionBatch(
    projectId: string,
    language: string,
    conventions: Array<{
      convention_type: string
      convention_key: string
      convention_value: string
    }>
  ): number {
    this.validateRequiredString(projectId, "projectId")
    this.validateRequiredString(language, "language")
    const sanitizedProjectId = this.sanitizeInput(projectId)
    const sanitizedLanguage = this.sanitizeInput(language)

    let count = 0
    this.transaction(() => {
      conventions.forEach(conv => {
        this.storeConvention(
          sanitizedProjectId,
          sanitizedLanguage,
          conv.convention_type,
          conv.convention_key,
          conv.convention_value
        )
        count++
      })
    })

    logger.debug("Convention batch stored", {
      projectId: sanitizedProjectId,
      language: sanitizedLanguage,
      count,
    })
    return count
  }

  // Utility Methods
  getRecentActivity(limit: number = 10): Array<{
    type: string
    timestamp: string
    details: any
  }> {
    // Combine recent activities from multiple tables
    const activities: Array<{ type: string; timestamp: string; details: any }> = []

    // Recent contexts
    const contextsStmt = this.db.prepare(`
      SELECT 'context' as type, updated_at as timestamp, session_id, key 
      FROM session_contexts 
      ORDER BY updated_at DESC 
      LIMIT ?
    `)
    const contexts = contextsStmt.all(limit) as any[]
    contexts.forEach(c => {
      activities.push({
        type: c.type,
        timestamp: c.timestamp,
        details: { session_id: c.session_id, key: c.key },
      })
    })

    // Recent tasks
    const tasksStmt = this.db.prepare(`
      SELECT 'task' as type, created_at as timestamp, id, title, state 
      FROM tasks 
      ORDER BY created_at DESC 
      LIMIT ?
    `)
    const tasks = tasksStmt.all(limit) as any[]
    tasks.forEach(t => {
      activities.push({
        type: t.type,
        timestamp: t.timestamp,
        details: { id: t.id, title: t.title, state: t.state },
      })
    })

    // Sort by timestamp and limit
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    return activities.slice(0, limit)
  }

  deleteContext(contextId: number): boolean {
    const stmt = this.db.prepare(`DELETE FROM session_contexts WHERE id = ?`)
    const result = stmt.run(contextId)

    if (result.changes > 0) {
      logger.debug("Context deleted", { contextId })
      return true
    }

    return false
  }

  deletePreference(preferenceId: number): boolean {
    const stmt = this.db.prepare(`DELETE FROM user_preferences WHERE id = ?`)
    const result = stmt.run(preferenceId)
    if (result.changes > 0) {
      logger.debug("Preference deleted", { preferenceId })
      return true
    }
    return false
  }

  updatePreference(
    preferenceId: number,
    data: {
      user_id?: string
      category?: string
      preference_key?: string
      preference_value?: string
      confidence?: number
    }
  ): boolean {
    const fields: string[] = []
    const params: any[] = []

    if (data.user_id !== undefined) {
      fields.push("user_id = ?")
      params.push(data.user_id)
    }
    if (data.category !== undefined) {
      fields.push("category = ?")
      params.push(data.category)
    }
    if (data.preference_key !== undefined) {
      fields.push("preference_key = ?")
      params.push(data.preference_key)
    }
    if (data.preference_value !== undefined) {
      fields.push("preference_value = ?")
      params.push(data.preference_value)
    }
    if (data.confidence !== undefined) {
      fields.push("confidence = ?")
      params.push(data.confidence)
    }

    if (fields.length === 0) return false

    fields.push("updated_at = CURRENT_TIMESTAMP")
    params.push(preferenceId)

    const stmt = this.db.prepare(`UPDATE user_preferences SET ${fields.join(", ")} WHERE id = ?`)
    const result = stmt.run(...params)
    if (result.changes > 0) {
      logger.debug("Preference updated", { preferenceId })
      return true
    }
    return false
  }

  deleteConvention(conventionId: number): boolean {
    const stmt = this.db.prepare(`DELETE FROM project_conventions WHERE id = ?`)
    const result = stmt.run(conventionId)
    if (result.changes > 0) {
      logger.debug("Convention deleted", { conventionId })
      return true
    }
    return false
  }

  getAllInteractions(
    limit: number = 50,
    offset: number = 0,
    role?: string
  ): { data: Interaction[]; total: number } {
    let countSql = `SELECT COUNT(*) as total FROM interactions`
    let dataSql = `SELECT * FROM interactions`
    const params: any[] = []

    if (role) {
      const sanitizedRole = this.sanitizeInput(role)
      countSql += ` WHERE role = ?`
      dataSql += ` WHERE role = ?`
      params.push(sanitizedRole)
    }

    dataSql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`

    const countResult = this.db.prepare(countSql).get(...params) as { total: number }
    const data = this.db.prepare(dataSql).all(...params, limit, offset) as Interaction[]

    return { data, total: countResult.total }
  }

  deleteInteraction(interactionId: number): boolean {
    const stmt = this.db.prepare(`DELETE FROM interactions WHERE id = ?`)
    const result = stmt.run(interactionId)
    if (result.changes > 0) {
      logger.debug("Interaction deleted", { interactionId })
      return true
    }
    return false
  }

  getSchemaVersion(): number {
    try {
      const stmt = this.db.prepare(
        `SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`
      )
      const result = stmt.get() as { version: number } | undefined
      return result?.version || 0
    } catch (error) {
      // Table doesn't exist yet
      return 0
    }
  }

  getIdempotencyResult(toolName: string, idempotencyKey: string): string | null {
    try {
      const stmt = this.db.prepare(`
        SELECT response_text FROM tool_idempotency
        WHERE idempotency_key = ? AND tool_name = ?
        LIMIT 1
      `)
      const row = stmt.get(idempotencyKey, toolName) as { response_text: string } | undefined
      return row?.response_text ?? null
    } catch (error) {
      // If table missing (older DB), treat as no cache.
      return null
    }
  }

  storeIdempotencyResult(toolName: string, idempotencyKey: string, responseText: string): void {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO tool_idempotency (idempotency_key, tool_name, response_text)
        VALUES (?, ?, ?)
      `)
      stmt.run(idempotencyKey, toolName, responseText)
    } catch (error) {
      // Non-fatal; idempotency is best-effort.
      logger.warn("Failed to store idempotency result", error as Error)
    }
  }

  isHealthy(): boolean {
    try {
      // Simple health check: try to query the database
      const stmt = this.db.prepare(`SELECT 1 as health`)
      const result = stmt.get() as { health: number } | undefined
      return result?.health === 1
    } catch (error) {
      logger.error("Health check failed", error as Error)
      return false
    }
  }

  // API Specification Methods
  storeApiSpec(
    specId: string,
    title: string,
    version: string,
    specJson: string,
    source: string,
    sourceType: string
  ): { inserted: boolean; updated: boolean } {
    const end = performanceTracker.start("storeApiSpec")

    this.validateRequiredString(specId, "specId")
    this.validateRequiredString(title, "title")
    this.validateRequiredString(version, "version")
    this.validateRequiredString(specJson, "specJson")
    this.validateRequiredString(sourceType, "sourceType")

    const sanitizedSpecId = this.sanitizeInput(specId)
    const sanitizedTitle = this.sanitizeInput(title)
    const sanitizedVersion = this.sanitizeInput(version)
    const sanitizedSource = source ? this.sanitizeInput(source) : null
    const sanitizedSourceType = this.sanitizeInput(sourceType)

    // Calculate hash for change detection
    const specHash = createHash("md5").update(specJson).digest("hex")

    // Check if spec already exists with same hash
    const existingStmt = this.db.prepare(`
      SELECT spec_hash FROM api_specs WHERE spec_id = ?
    `)
    const existing = existingStmt.get(sanitizedSpecId) as { spec_hash: string } | undefined

    if (existing && existing.spec_hash === specHash) {
      // No changes, just update last_synced
      const updateSyncStmt = this.db.prepare(`
        UPDATE api_specs SET last_synced = CURRENT_TIMESTAMP WHERE spec_id = ?
      `)
      updateSyncStmt.run(sanitizedSpecId)

      end()
      logger.debug("API spec unchanged, updated sync time", { specId: sanitizedSpecId })
      return { inserted: false, updated: false }
    }

    // Insert or update spec
    const stmt = this.db.prepare(`
      INSERT INTO api_specs (spec_id, title, version, spec_json, spec_hash, source, source_type, last_synced, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(spec_id) 
      DO UPDATE SET 
        title = excluded.title,
        version = excluded.version,
        spec_json = excluded.spec_json,
        spec_hash = excluded.spec_hash,
        source = excluded.source,
        source_type = excluded.source_type,
        last_synced = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `)

    stmt.run(
      sanitizedSpecId,
      sanitizedTitle,
      sanitizedVersion,
      specJson,
      specHash,
      sanitizedSource,
      sanitizedSourceType
    )

    end()
    const isUpdate = existing !== undefined
    logger.debug(`API spec ${isUpdate ? "updated" : "stored"}`, {
      specId: sanitizedSpecId,
      title: sanitizedTitle,
    })

    return { inserted: !isUpdate, updated: isUpdate }
  }

  getApiSpec(specId: string): ApiSpec | null {
    this.validateRequiredString(specId, "specId")
    const sanitizedSpecId = this.sanitizeInput(specId)

    const stmt = this.db.prepare(`
      SELECT * FROM api_specs WHERE spec_id = ?
    `)

    return stmt.get(sanitizedSpecId) as ApiSpec | null
  }

  listApiSpecs(): Array<{
    spec_id: string
    title: string
    version: string
    endpoint_count: number
    last_synced: string
  }> {
    const stmt = this.db.prepare(`
      SELECT 
        s.spec_id,
        s.title,
        s.version,
        s.last_synced,
        COUNT(e.id) as endpoint_count
      FROM api_specs s
      LEFT JOIN api_endpoints e ON s.spec_id = e.spec_id
      GROUP BY s.spec_id, s.title, s.version, s.last_synced
      ORDER BY s.updated_at DESC
    `)

    return stmt.all() as Array<{
      spec_id: string
      title: string
      version: string
      endpoint_count: number
      last_synced: string
    }>
  }

  deleteApiSpec(specId: string): boolean {
    this.validateRequiredString(specId, "specId")
    const sanitizedSpecId = this.sanitizeInput(specId)

    const stmt = this.db.prepare(`DELETE FROM api_specs WHERE spec_id = ?`)
    const result = stmt.run(sanitizedSpecId)

    if (result.changes > 0) {
      logger.debug("API spec deleted", { specId: sanitizedSpecId })
      return true
    }

    return false
  }

  // API Endpoint Methods
  storeApiEndpoint(
    specId: string,
    path: string,
    method: string,
    operationId?: string,
    summary?: string,
    description?: string,
    tags?: string[],
    isDeprecated: boolean = false,
    requestBody?: any,
    responses?: any
  ): void {
    this.validateRequiredString(specId, "specId")
    this.validateRequiredString(path, "path")
    this.validateRequiredString(method, "method")

    const sanitizedSpecId = this.sanitizeInput(specId)
    const sanitizedPath = this.sanitizeInput(path)
    const sanitizedMethod = this.sanitizeInput(method)
    const sanitizedOperationId = operationId ? this.sanitizeInput(operationId) : null
    const sanitizedSummary = summary ? this.sanitizeInput(summary) : null
    const sanitizedDescription = description ? this.sanitizeInput(description) : null
    const tagsJson = tags ? JSON.stringify(tags) : null
    const requestBodyJson = requestBody ? JSON.stringify(requestBody) : null
    const responsesJson = responses ? JSON.stringify(responses) : null

    const stmt = this.db.prepare(`
      INSERT INTO api_endpoints (
        spec_id, path, method, operation_id, summary, description, tags, 
        is_deprecated, request_body, responses
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(spec_id, path, method) 
      DO UPDATE SET 
        operation_id = excluded.operation_id,
        summary = excluded.summary,
        description = excluded.description,
        tags = excluded.tags,
        is_deprecated = excluded.is_deprecated,
        request_body = excluded.request_body,
        responses = excluded.responses
    `)

    stmt.run(
      sanitizedSpecId,
      sanitizedPath,
      sanitizedMethod,
      sanitizedOperationId,
      sanitizedSummary,
      sanitizedDescription,
      tagsJson,
      isDeprecated ? 1 : 0,
      requestBodyJson,
      responsesJson
    )

    logger.debug("API endpoint stored", {
      specId: sanitizedSpecId,
      method: sanitizedMethod,
      path: sanitizedPath,
    })
  }

  getApiEndpoints(
    specId?: string,
    pathPattern?: string,
    method?: string,
    tag?: string,
    limit: number = 20
  ): ApiEndpoint[] {
    let sql = `SELECT * FROM api_endpoints WHERE 1=1`
    const params: any[] = []

    if (specId) {
      const sanitizedSpecId = this.sanitizeInput(specId)
      sql += ` AND spec_id = ?`
      params.push(sanitizedSpecId)
    }

    if (pathPattern) {
      const sanitizedPathPattern = this.sanitizeInput(pathPattern)
      sql += ` AND path LIKE ?`
      params.push(`%${sanitizedPathPattern}%`)
    }

    if (method) {
      const sanitizedMethod = this.sanitizeInput(method)
      sql += ` AND method = ?`
      params.push(sanitizedMethod)
    }

    if (tag) {
      const sanitizedTag = this.sanitizeInput(tag)
      sql += ` AND tags LIKE ?`
      params.push(`%"${sanitizedTag}"%`)
    }

    sql += ` ORDER BY path, method LIMIT ?`
    params.push(limit)

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as ApiEndpoint[]
  }

  getApiEndpointDetail(specId: string, path: string, method: string): ApiEndpoint | null {
    this.validateRequiredString(specId, "specId")
    this.validateRequiredString(path, "path")
    this.validateRequiredString(method, "method")

    const sanitizedSpecId = this.sanitizeInput(specId)
    const sanitizedPath = this.sanitizeInput(path)
    const sanitizedMethod = this.sanitizeInput(method)

    const stmt = this.db.prepare(`
      SELECT * FROM api_endpoints 
      WHERE spec_id = ? AND path = ? AND method = ?
    `)

    return stmt.get(sanitizedSpecId, sanitizedPath, sanitizedMethod) as ApiEndpoint | null
  }

  searchApiEndpoints(query: string, specId?: string, limit: number = 10): ApiEndpoint[] {
    this.validateRequiredString(query, "query")
    const sanitizedQuery = this.sanitizeInput(query)

    // Check if FTS5 table exists
    const ftsCheckStmt = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='api_endpoints_fts'
    `)
    const ftsExists = ftsCheckStmt.get()

    if (ftsExists) {
      // Use FTS5 for full-text search
      let sql = `
        SELECT e.* FROM api_endpoints e
        INNER JOIN api_endpoints_fts fts ON e.id = fts.rowid
        WHERE api_endpoints_fts MATCH ?
      `
      const params: any[] = [sanitizedQuery]

      if (specId) {
        const sanitizedSpecId = this.sanitizeInput(specId)
        sql += ` AND e.spec_id = ?`
        params.push(sanitizedSpecId)
      }

      sql += ` ORDER BY rank LIMIT ?`
      params.push(limit)

      const stmt = this.db.prepare(sql)
      return stmt.all(...params) as ApiEndpoint[]
    } else {
      // Fallback to LIKE queries
      let sql = `
        SELECT * FROM api_endpoints 
        WHERE (
          summary LIKE ? OR 
          description LIKE ? OR 
          path LIKE ? OR 
          tags LIKE ?
        )
      `
      const likeQuery = `%${sanitizedQuery}%`
      const params: any[] = [likeQuery, likeQuery, likeQuery, likeQuery]

      if (specId) {
        const sanitizedSpecId = this.sanitizeInput(specId)
        sql += ` AND spec_id = ?`
        params.push(sanitizedSpecId)
      }

      sql += ` ORDER BY path LIMIT ?`
      params.push(limit)

      const stmt = this.db.prepare(sql)
      return stmt.all(...params) as ApiEndpoint[]
    }
  }

  // API Schema Methods
  storeApiSchema(specId: string, schemaName: string, schemaJson: string): void {
    this.validateRequiredString(specId, "specId")
    this.validateRequiredString(schemaName, "schemaName")
    this.validateRequiredString(schemaJson, "schemaJson")

    const sanitizedSpecId = this.sanitizeInput(specId)
    const sanitizedSchemaName = this.sanitizeInput(schemaName)

    const stmt = this.db.prepare(`
      INSERT INTO api_schemas (spec_id, schema_name, schema_json)
      VALUES (?, ?, ?)
      ON CONFLICT(spec_id, schema_name) 
      DO UPDATE SET schema_json = excluded.schema_json
    `)

    stmt.run(sanitizedSpecId, sanitizedSchemaName, schemaJson)
    logger.debug("API schema stored", { specId: sanitizedSpecId, schemaName: sanitizedSchemaName })
  }

  getApiSchema(specId: string, schemaName: string): ApiSchema | null {
    this.validateRequiredString(specId, "specId")
    this.validateRequiredString(schemaName, "schemaName")

    const sanitizedSpecId = this.sanitizeInput(specId)
    const sanitizedSchemaName = this.sanitizeInput(schemaName)

    const stmt = this.db.prepare(`
      SELECT * FROM api_schemas 
      WHERE spec_id = ? AND schema_name = ?
    `)

    return stmt.get(sanitizedSpecId, sanitizedSchemaName) as ApiSchema | null
  }

  // FeathersJS Service Methods
  storeFeathersService(
    specId: string,
    serviceName: string,
    servicePath: string,
    methods: string[],
    hooks?: any,
    events?: string[],
    sourceFile?: string
  ): void {
    this.validateRequiredString(specId, "specId")
    this.validateRequiredString(serviceName, "serviceName")
    this.validateRequiredString(servicePath, "servicePath")

    const sanitizedSpecId = this.sanitizeInput(specId)
    const sanitizedServiceName = this.sanitizeInput(serviceName)
    const sanitizedServicePath = this.sanitizeInput(servicePath)
    const sanitizedSourceFile = sourceFile ? this.sanitizeInput(sourceFile) : null

    const methodsJson = JSON.stringify(methods)
    const hooksJson = hooks ? JSON.stringify(hooks) : null
    const eventsJson = events ? JSON.stringify(events) : null

    const stmt = this.db.prepare(`
      INSERT INTO api_services (
        spec_id, service_name, service_path, methods, hooks, events, source_file
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(spec_id, service_path) 
      DO UPDATE SET 
        service_name = excluded.service_name,
        methods = excluded.methods,
        hooks = excluded.hooks,
        events = excluded.events,
        source_file = excluded.source_file
    `)

    stmt.run(
      sanitizedSpecId,
      sanitizedServiceName,
      sanitizedServicePath,
      methodsJson,
      hooksJson,
      eventsJson,
      sanitizedSourceFile
    )

    logger.debug("FeathersJS service stored", {
      specId: sanitizedSpecId,
      servicePath: sanitizedServicePath,
    })
  }

  getFeathersServices(specId?: string, serviceName?: string): FeathersService[] {
    let sql = `SELECT * FROM api_services WHERE 1=1`
    const params: any[] = []

    if (specId) {
      const sanitizedSpecId = this.sanitizeInput(specId)
      sql += ` AND spec_id = ?`
      params.push(sanitizedSpecId)
    }

    if (serviceName) {
      const sanitizedServiceName = this.sanitizeInput(serviceName)
      sql += ` AND service_name LIKE ?`
      params.push(`%${sanitizedServiceName}%`)
    }

    sql += ` ORDER BY service_path`

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as FeathersService[]
  }

  // Memory Entity Methods (v9 enhanced memory system)
  storeMemoryEntities(
    memoryId: number,
    entities: Array<{ name: string; type: string; confidence?: number }>
  ): number {
    if (!entities || entities.length === 0) {
      return 0
    }

    let storedCount = 0
    const stmt = this.db.prepare(`
      INSERT INTO memory_entities (memory_id, entity_name, entity_type, confidence)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(memory_id, entity_name, entity_type) 
      DO UPDATE SET confidence = excluded.confidence
    `)

    for (const entity of entities) {
      try {
        const sanitizedName = this.sanitizeInput(entity.name)
        const sanitizedType = this.sanitizeInput(entity.type)
        const confidence = entity.confidence ?? 1.0

        stmt.run(memoryId, sanitizedName, sanitizedType, confidence)
        storedCount++
      } catch (error) {
        logger.warn("Failed to store entity", { memoryId, entity, error })
      }
    }

    logger.debug("Memory entities stored", { memoryId, count: storedCount })
    return storedCount
  }

  getMemoryEntities(
    entityType?: string,
    limit: number = 50
  ): Array<{ entity_name: string; entity_type: string; count: number }> {
    let sql = `
      SELECT entity_name, entity_type, COUNT(*) as count 
      FROM memory_entities 
      WHERE 1=1
    `
    const params: any[] = []

    if (entityType) {
      const sanitizedType = this.sanitizeInput(entityType)
      sql += ` AND entity_type = ?`
      params.push(sanitizedType)
    }

    sql += ` GROUP BY entity_name, entity_type ORDER BY count DESC LIMIT ?`
    params.push(limit)

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as Array<{ entity_name: string; entity_type: string; count: number }>
  }

  storeMemoryEvolution(
    memoryId: number,
    evolutionNote: string,
    previousValue?: string,
    changedBy?: string
  ): number {
    this.validateRequiredString(evolutionNote, "evolutionNote")
    const sanitizedNote = this.sanitizeInput(evolutionNote)
    const sanitizedChangedBy = changedBy ? this.sanitizeInput(changedBy) : null

    const stmt = this.db.prepare(`
      INSERT INTO memory_evolutions (memory_id, evolution_note, previous_value, changed_by)
      VALUES (?, ?, ?, ?)
    `)

    const result = stmt.run(memoryId, sanitizedNote, previousValue || null, sanitizedChangedBy)
    logger.debug("Memory evolution stored", { memoryId, evolutionId: result.lastInsertRowid })
    return result.lastInsertRowid
  }

  getMemoryEvolutions(memoryId: number): Array<{
    id: number
    memory_id: number
    evolution_note: string
    previous_value: string | null
    changed_by: string | null
    created_at: string
  }> {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_evolutions 
      WHERE memory_id = ? 
      ORDER BY created_at DESC
    `)
    return stmt.all(memoryId) as any[]
  }

  queryMemory(query: string, limit: number = 20): SessionContext[] {
    this.validateRequiredString(query, "query")
    const sanitizedQuery = this.sanitizeInput(query)
    const stmt = this.db.prepare(`
      SELECT *
      FROM session_contexts
      WHERE context_type = 'memory'
        AND (key LIKE ? OR value LIKE ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `)

    return stmt.all(`%${sanitizedQuery}%`, `%${sanitizedQuery}%`, limit) as SessionContext[]
  }

  updateMemory(memoryId: number, newValue: string, metadata?: string): boolean {
    this.validateRequiredString(newValue, "newValue")
    const stmt = this.db.prepare(`
      UPDATE session_contexts
      SET value = ?, metadata = COALESCE(?, metadata), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND context_type = 'memory'
    `)

    const result = stmt.run(newValue, metadata || null, memoryId)
    return result.changes > 0
  }

  linkMemoryToProject(
    memoryId: number,
    projectName: string
  ): { projectId: number; linked: boolean; taskId?: number } {
    this.validateRequiredString(projectName, "projectName")
    const sanitizedProjectName = this.sanitizeInput(projectName)

    const upsertProjectStmt = this.db.prepare(`
      INSERT INTO projects (name, status, priority)
      VALUES (?, 'active', 3)
      ON CONFLICT(name) DO UPDATE SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `)
    upsertProjectStmt.run(sanitizedProjectName)

    const projectStmt = this.db.prepare(`SELECT id FROM projects WHERE name = ?`)
    const project = projectStmt.get(sanitizedProjectName) as { id: number } | undefined
    if (!project) {
      return { projectId: 0, linked: false }
    }

    const memory = this.db
      .prepare(
        `
      SELECT id, key, value
      FROM session_contexts
      WHERE id = ? AND context_type = 'memory'
    `
      )
      .get(memoryId) as { id: number; key: string; value: string } | undefined

    if (!memory) {
      return { projectId: project.id, linked: false }
    }

    const existingTask = this.db
      .prepare(
        `
      SELECT id
      FROM operational_tasks
      WHERE project_id = ?
        AND title = ?
        AND COALESCE(description, '') = COALESCE(?, '')
      LIMIT 1
    `
      )
      .get(project.id, memory.key, memory.value) as { id: number } | undefined

    if (existingTask) {
      return { projectId: project.id, linked: true, taskId: existingTask.id }
    }

    const taskInsert = this.db.prepare(`
      INSERT INTO operational_tasks (title, description, project_id, status, priority, last_seen_at, resurfacing_score)
      VALUES (?, ?, ?, 'open', 3, (strftime('%Y-%m-%dT%H:%M:%fZ','now')), 1)
    `)
    const result = taskInsert.run(memory.key, memory.value, project.id)

    return { projectId: project.id, linked: true, taskId: result.lastInsertRowid }
  }

  getDailyBriefing(): Record<string, unknown> {
    const unfinishedTasks = this.db
      .prepare(
        `
      SELECT id, title, status, priority, due_at, resurfacing_score
      FROM operational_tasks
      WHERE status NOT IN ('done', 'cancelled')
      ORDER BY COALESCE(due_at, '9999-12-31T00:00:00Z') ASC, resurfacing_score DESC, priority ASC
      LIMIT 12
    `
      )
      .all()

    const upcomingReminders = this.db
      .prepare(
        `
      SELECT id, message, due_at, priority
      FROM reminders
      WHERE status = 'pending'
      ORDER BY COALESCE(due_at, '9999-12-31T00:00:00Z') ASC, priority ASC
      LIMIT 10
    `
      )
      .all()

    const openLoops = this.db
      .prepare(
        `
      SELECT id, description, source, created_at, last_seen_at
      FROM open_loops
      ORDER BY COALESCE(last_seen_at, created_at) ASC
      LIMIT 10
    `
      )
      .all()

    return {
      generated_at: new Date().toISOString(),
      unfinished_prs_hint: "Use work-tracker sync for live GitHub PR state",
      unfinished_tasks: unfinishedTasks,
      upcoming_commitments: upcomingReminders,
      open_loops: openLoops,
    }
  }

  getWeeklyReview(): Record<string, unknown> {
    const projectSummary = this.db
      .prepare(
        `
      SELECT p.id, p.name, p.status, COUNT(t.id) AS open_task_count
      FROM projects p
      LEFT JOIN operational_tasks t ON t.project_id = p.id AND t.status NOT IN ('done', 'cancelled')
      GROUP BY p.id, p.name, p.status
      ORDER BY open_task_count DESC, p.priority ASC
    `
      )
      .all()

    const staleDocs = this.db
      .prepare(
        `
      SELECT id, title, artifact_type, path, updated_at
      FROM artifacts
      WHERE status = 'active'
      ORDER BY updated_at ASC
      LIMIT 10
    `
      )
      .all()

    return {
      generated_at: new Date().toISOString(),
      project_summary: projectSummary,
      stale_docs: staleDocs,
      recommendation: "Review top projects with highest open task counts and close stale loops.",
    }
  }

  getStaleWorkScan(staleHours: number = 72): Record<string, unknown> {
    const staleTasks = this.db
      .prepare(
        `
      SELECT id, title, status, last_seen_at, resurfacing_score
      FROM operational_tasks
      WHERE status NOT IN ('done', 'cancelled')
        AND (
          last_seen_at IS NULL
          OR datetime(last_seen_at) < datetime('now', ?)
        )
      ORDER BY resurfacing_score DESC, last_seen_at ASC
      LIMIT 20
    `
      )
      .all(`-${staleHours} hours`)

    const staleLoops = this.db
      .prepare(
        `
      SELECT id, description, source, last_seen_at
      FROM open_loops
      WHERE last_seen_at IS NULL
         OR datetime(last_seen_at) < datetime('now', ?)
      ORDER BY last_seen_at ASC
      LIMIT 20
    `
      )
      .all(`-${staleHours} hours`)

    return {
      generated_at: new Date().toISOString(),
      stale_hours: staleHours,
      tasks_worth_resurfacing: staleTasks,
      stale_open_loops: staleLoops,
    }
  }

  // Close database connection
  close(): void {
    if (this.db) {
      this.db.close()
      this.initialized = false
      logger.info("Database connection closed")
    }
  }
}
