#!/usr/bin/env node
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
    includeContexts: false,
    includePreferences: true,
    includeConventions: true,
    includeRoutingPatterns: true,
    contextsLimit: 1000,
    minRoutingConfidence: 0.0,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
      break;
    }
    if (a === "--db") args.db = argv[++i];
    else if (a === "--include-contexts") args.includeContexts = true;
    else if (a === "--no-preferences") args.includePreferences = false;
    else if (a === "--no-conventions") args.includeConventions = false;
    else if (a === "--no-routing-patterns") args.includeRoutingPatterns = false;
    else if (a === "--contexts-limit") args.contextsLimit = Number(argv[++i] || "1000");
    else if (a === "--min-routing-confidence") args.minRoutingConfidence = Number(argv[++i] || "0");
    else throw new Error(`Unknown argument: ${a}`);
  }

  return args;
}

function usage() {
  return [
    "Export OpenCode session-memory data as JSON (for sharing/import).",
    "",
    "Usage:",
    "  export-session-memory.mjs [--db PATH] [--include-contexts] [--contexts-limit N]",
    "    [--no-preferences] [--no-conventions] [--no-routing-patterns] [--min-routing-confidence N]",
    "",
    "Notes:",
    "  - Defaults export: preferences + conventions + routing-patterns (no session contexts).",
    "  - Set SESSION_DB to override default DB path.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

const db = new SessionDatabase(args.db);
await db.initialize();

const adapter = db.db;
const out = {
  version: 1,
  exported_at: new Date().toISOString(),
  source: {
    db_path: args.db,
  },
  data: {},
};

if (args.includeContexts) {
  out.data.session_contexts = adapter
    .prepare("SELECT * FROM session_contexts ORDER BY updated_at DESC LIMIT ?")
    .all(args.contextsLimit);
}

if (args.includePreferences) {
  out.data.user_preferences = adapter
    .prepare("SELECT * FROM user_preferences ORDER BY confidence DESC, occurrences DESC, updated_at DESC")
    .all();
}

if (args.includeConventions) {
  out.data.project_conventions = adapter
    .prepare("SELECT * FROM project_conventions ORDER BY updated_at DESC")
    .all();
}

if (args.includeRoutingPatterns) {
  out.data.routing_patterns = adapter
    .prepare("SELECT * FROM routing_patterns WHERE confidence >= ? ORDER BY confidence DESC, success_count DESC, updated_at DESC")
    .all(args.minRoutingConfidence);
}

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
