#!/usr/bin/env node
import { readFileSync } from "fs";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { SessionDatabase } from "../dist/database.js";

function resolveDefaultDbPath() {
  if (process.env.SESSION_DB) return process.env.SESSION_DB;
  if (process.env.SESSION_DB_PATH) return process.env.SESSION_DB_PATH;

  const canonicalDbPath = join(homedir(), ".agents", "memory", "session.db");
  const legacyDbPath = join(homedir(), ".opencode", "sessions", "session.db");

  if (existsSync(canonicalDbPath)) return canonicalDbPath;
  if (existsSync(legacyDbPath)) return legacyDbPath;
  return canonicalDbPath;
}

function parseArgs(argv) {
  const args = {
    db: resolveDefaultDbPath(),
    file: "",
    overwrite: false,
    sessionIdOverride: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
      break;
    }
    if (a === "--db") args.db = argv[++i];
    else if (a === "--file") args.file = argv[++i];
    else if (a === "--overwrite") args.overwrite = true;
    else if (a === "--session-id") args.sessionIdOverride = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }

  return args;
}

function usage() {
  return [
    "Import OpenCode session-memory export JSON into a local SESSION_DB.",
    "",
    "Usage:",
    "  import-session-memory.mjs --file PATH [--db PATH] [--overwrite] [--session-id SESSION]",
    "",
    "Notes:",
    "  - Supports exports produced by export-session-memory.mjs.",
    "  - Also supports legacy exports that are a JSON array of session_contexts rows.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

if (!args.file) {
  process.stderr.write("error: --file is required\n");
  process.exit(2);
}

const payload = JSON.parse(readFileSync(args.file, "utf-8"));
const data =
  Array.isArray(payload)
    ? { session_contexts: payload }
    : (payload?.data && typeof payload.data === "object" ? payload.data : {});

const db = new SessionDatabase(args.db);
await db.initialize();

const adapter = db.db;
const raw = adapter.getRaw();

let imported = 0;
let skipped = 0;

function coerceMetadata(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function runMany(rows, fn) {
  for (const row of rows) {
    try {
      const did = fn(row);
      if (did) imported++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
}

raw.run("BEGIN");
try {
  if (Array.isArray(data.session_contexts) && data.session_contexts.length) {
    runMany(data.session_contexts, (m) => {
      const sessionId = args.sessionIdOverride || m.session_id || "imported";
      if (!m.context_type || !m.key || m.value === undefined || m.value === null) return false;

      const sql = args.overwrite
        ? `
          INSERT INTO session_contexts (session_id, context_type, key, value, metadata, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(session_id, context_type, key)
          DO UPDATE SET value = excluded.value, metadata = excluded.metadata, updated_at = CURRENT_TIMESTAMP
        `
        : `
          INSERT OR IGNORE INTO session_contexts (session_id, context_type, key, value, metadata, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;

      raw.run(sql, [
        String(sessionId),
        String(m.context_type),
        String(m.key),
        String(m.value),
        coerceMetadata(m.metadata),
      ]);
      return true;
    });
  }

  if (Array.isArray(data.user_preferences) && data.user_preferences.length) {
    runMany(data.user_preferences, (p) => {
      if (!p.user_id || !p.preference_key || p.preference_value === undefined || p.preference_value === null) return false;
      const sql = args.overwrite
        ? `
          INSERT INTO user_preferences (
            user_id, category, preference_key, preference_value, confidence, occurrences, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, preference_key)
          DO UPDATE SET
            category = excluded.category,
            preference_value = excluded.preference_value,
            confidence = excluded.confidence,
            occurrences = excluded.occurrences,
            updated_at = CURRENT_TIMESTAMP
        `
        : `
          INSERT INTO user_preferences (
            user_id, category, preference_key, preference_value, confidence, occurrences, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, preference_key)
          DO UPDATE SET
            category = excluded.category,
            preference_value = excluded.preference_value,
            confidence = MAX(user_preferences.confidence, excluded.confidence),
            occurrences = user_preferences.occurrences + excluded.occurrences,
            updated_at = CURRENT_TIMESTAMP
        `;

      raw.run(sql, [
        String(p.user_id),
        String(p.category || "general"),
        String(p.preference_key),
        String(p.preference_value),
        Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : 1.0,
        Number.isFinite(Number(p.occurrences)) ? Number(p.occurrences) : 1,
      ]);
      return true;
    });
  }

  if (Array.isArray(data.project_conventions) && data.project_conventions.length) {
    runMany(data.project_conventions, (c) => {
      if (!c.project_id || !c.language || !c.convention_type || !c.convention_key || c.convention_value === undefined || c.convention_value === null) return false;
      const sql = args.overwrite
        ? `
          INSERT INTO project_conventions (
            project_id, language, convention_type, convention_key, convention_value, updated_at
          ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(project_id, language, convention_type, convention_key)
          DO UPDATE SET
            convention_value = excluded.convention_value,
            updated_at = CURRENT_TIMESTAMP
        `
        : `
          INSERT OR IGNORE INTO project_conventions (
            project_id, language, convention_type, convention_key, convention_value, updated_at
          ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;

      raw.run(sql, [
        String(c.project_id),
        String(c.language),
        String(c.convention_type),
        String(c.convention_key),
        String(c.convention_value),
      ]);
      return true;
    });
  }

  if (Array.isArray(data.routing_patterns) && data.routing_patterns.length) {
    runMany(data.routing_patterns, (r) => {
      if (!r.pattern_key || !r.agent_name) return false;
      const sql = args.overwrite
        ? `
          INSERT INTO routing_patterns (
            pattern_key, agent_name, confidence, file_count, loc_estimate,
            success_count, failure_count, metadata, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(pattern_key, agent_name)
          DO UPDATE SET
            confidence = excluded.confidence,
            file_count = excluded.file_count,
            loc_estimate = excluded.loc_estimate,
            success_count = excluded.success_count,
            failure_count = excluded.failure_count,
            metadata = excluded.metadata,
            updated_at = CURRENT_TIMESTAMP
        `
        : `
          INSERT INTO routing_patterns (
            pattern_key, agent_name, confidence, file_count, loc_estimate,
            success_count, failure_count, metadata, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(pattern_key, agent_name)
          DO UPDATE SET
            confidence = MAX(routing_patterns.confidence, excluded.confidence),
            file_count = excluded.file_count,
            loc_estimate = excluded.loc_estimate,
            success_count = routing_patterns.success_count + excluded.success_count,
            failure_count = routing_patterns.failure_count + excluded.failure_count,
            metadata = COALESCE(excluded.metadata, routing_patterns.metadata),
            updated_at = CURRENT_TIMESTAMP
        `;

      raw.run(sql, [
        String(r.pattern_key),
        String(r.agent_name),
        Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0.5,
        Number.isFinite(Number(r.file_count)) ? Number(r.file_count) : 0,
        Number.isFinite(Number(r.loc_estimate)) ? Number(r.loc_estimate) : 0,
        Number.isFinite(Number(r.success_count)) ? Number(r.success_count) : 0,
        Number.isFinite(Number(r.failure_count)) ? Number(r.failure_count) : 0,
        coerceMetadata(r.metadata),
      ]);
      return true;
    });
  }

  raw.run("COMMIT");
} catch (e) {
  raw.run("ROLLBACK");
  throw e;
}

adapter.save();

process.stdout.write(`ok: imported=${imported} skipped=${skipped}\n`);
