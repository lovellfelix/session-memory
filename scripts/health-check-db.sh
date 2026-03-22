#!/usr/bin/env bash
# health-check-db.sh - Database health verification (SessionDatabase-based)

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
resolve_db_path() {
  local canonical_db_path="$HOME/.agents/memory/session.db"
  local legacy_db_path="$HOME/.opencode/sessions/session.db"

  if [[ -n "${SESSION_DB:-}" ]]; then
    printf '%s\n' "$SESSION_DB"
    return
  fi

  if [[ -n "${SESSION_DB_PATH:-}" ]]; then
    printf '%s\n' "$SESSION_DB_PATH"
    return
  fi

  if [[ -f "$canonical_db_path" ]]; then
    printf '%s\n' "$canonical_db_path"
    return
  fi

  if [[ -f "$legacy_db_path" ]]; then
    printf '%s\n' "$legacy_db_path"
    return
  fi

  printf '%s\n' "$canonical_db_path"
}

db_path="$(resolve_db_path)"
db_module="$script_dir/../dist/database.js"

echo "Database Health Check"
echo "====================="
echo ""

command -v node >/dev/null 2>&1 || {
  echo "FAIL: node not found" >&2
  exit 1
}

if [[ ! -f "$db_path" ]]; then
  echo "FAIL: database not found: $db_path" >&2
  exit 1
fi

if [[ ! -f "$db_module" ]]; then
  echo "FAIL: session-memory not built (missing $db_module)" >&2
  echo "Run: cd $(dirname "$db_module")/.. && npm run build" >&2
  exit 1
fi

DB_PATH="$db_path" DB_MODULE="$db_module" node --input-type=module - <<'NODE'
import { pathToFileURL } from 'url'

const dbPath = process.env.DB_PATH
const dbModule = process.env.DB_MODULE

if (!dbPath || !dbModule) {
  throw new Error('DB_PATH and DB_MODULE env vars are required')
}

const mod = await import(pathToFileURL(dbModule).href)
const { SessionDatabase } = mod

const db = new SessionDatabase(dbPath)
await db.initialize()

const healthy = db.isHealthy()
if (!healthy) {
  console.error('FAIL: isHealthy() returned false')
  db.close()
  process.exit(1)
}

const stats = db.getStats()

const raw = db.getRawDb()
let userVersion = 0
try {
  const res = raw.exec('PRAGMA user_version')
  userVersion = res?.[0]?.values?.[0]?.[0] ?? 0
} catch {}

let tableCount = 0
try {
  const res = raw.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
  tableCount = res?.[0]?.values?.[0]?.[0] ?? 0
} catch {}

console.log(`OK: database file: ${dbPath}`)
console.log(`OK: schema user_version: ${userVersion}`)
console.log(`OK: table count: ${tableCount}`)
console.log('')
console.log('Record Counts:')
console.log(`- Session Contexts: ${stats.contexts.count}`)
console.log(`- Sessions:         ${stats.sessions.count}`)
console.log(`- Preferences:      ${stats.preferences.count}`)
console.log(`- Conventions:      ${stats.conventions.count}`)
console.log(`- Interactions:     ${stats.interactions.count}`)
console.log(`- Tasks:            ${stats.tasks.count}`)
console.log(`- Routing patterns: ${stats.routingPatterns.count}`)

db.close()
console.log('')
console.log('OK: health check passed')
NODE
