#!/usr/bin/env node
/**
 * smem — first-class CLI for the session-memory MCP server (Phase 7b).
 *
 * All commands use SessionDatabase directly (sql.js backend, no extra deps).
 *
 * NOTE: SessionMemoryClientFactory.createDirectClient() was the original design
 * target for the write commands (trivial remote-swap in RFC Phase 3), but its
 * ConnectionPool requires better-sqlite3 which is not installed in this project
 * (sql.js is used instead). Revisit when better-sqlite3 is added or the pool
 * is updated to support sql.js.
 *
 * DB resolution order:
 *   SESSION_DB → SESSION_DB_PATH → ~/.agents/memory/session.db
 *   → ~/.opencode/sessions/session.db (legacy fallback)
 */

import { existsSync } from "fs"
import { join } from "path"
import { SessionDatabase } from "./database.js"

// ── DB path resolution ────────────────────────────────────────────────────────

function resolveDbPath(): string {
  if (process.env.SESSION_DB) return process.env.SESSION_DB
  if (process.env.SESSION_DB_PATH) return process.env.SESSION_DB_PATH
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  const canonical = join(home, ".agents", "memory", "session.db")
  const legacy = join(home, ".opencode", "sessions", "session.db")
  return existsSync(canonical) ? canonical : existsSync(legacy) ? legacy : canonical
}

// ── Argument parsing ──────────────────────────────────────────────────────────

interface ParsedArgs {
  json: boolean
  args: string[]
}

function parseArgs(argv: string[]): ParsedArgs {
  const json = argv.includes("--json")
  return { json, args: argv.filter(a => a !== "--json") }
}

// ── Output helpers ────────────────────────────────────────────────────────────

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

function die(msg: string): never {
  console.error(`smem: ${msg}`)
  process.exit(1)
}

// ── Help ─────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`smem — session-memory CLI

Usage: smem [--json] <command> [args...]

Read commands (safe against the real DB):
  stats                           Row counts for every table
  recent [limit]                  Latest activity, newest-first (default: 10)
  health                          DB liveness check (exits 1 if unhealthy)
  recall <query>                  Search memory-type contexts (LIKE match)
  search <query>                  Alias for recall

Write commands (set SESSION_DB=/tmp/test.db to avoid touching real data):
  get-prefs [user]                List preferences (default user: default)
  track-pref <user> <cat> <key> <value> [confidence]
                                  Upsert a user preference (default conf: 0.8)
  store-context <session> <type> <key> <value...>
                                  Store / update a session context entry
  store-interaction <session> <role> <content...>
                                  Append an interaction to a session

Flags:
  --json    Machine-readable JSON on stdout (works with every command)
  --help    Show this help

Environment:
  SESSION_DB / SESSION_DB_PATH    Override DB path
  Default DB : ~/.agents/memory/session.db
  Legacy DB  : ~/.opencode/sessions/session.db (used when default absent)`)
}

// ── Command implementations ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2)

  if (
    rawArgv.length === 0 ||
    rawArgv[0] === "--help" ||
    rawArgv[0] === "-h" ||
    rawArgv[0] === "help"
  ) {
    showHelp()
    return
  }

  const { json, args } = parseArgs(rawArgv)
  const [command, ...rest] = args
  const dbPath = resolveDbPath()

  const db = new SessionDatabase(dbPath)
  await db.initialize()

  try {
    switch (command) {
      // ── Read commands ───────────────────────────────────────────────────────

      case "stats": {
        const s = db.getStats() as Record<string, { count: number } | undefined>
        const get = (k: string) => s[k]?.count ?? 0
        if (json) {
          const flat: Record<string, number> = {}
          for (const [k, v] of Object.entries(s)) flat[k] = v?.count ?? 0
          printJson(flat)
        } else {
          const pad = (n: number) => String(n).padStart(7)
          console.log(`sessions       ${pad(get("sessions"))}`)
          console.log(`contexts       ${pad(get("contexts"))}`)
          console.log(`preferences    ${pad(get("preferences"))}`)
          console.log(`conventions    ${pad(get("conventions"))}`)
          console.log(`interactions   ${pad(get("interactions"))}`)
          console.log(`tasks          ${pad(get("tasks"))}`)
          console.log(`routing        ${pad(get("routingPatterns"))}`)
          console.log(`artifact_reads ${pad(get("artifactReads"))}`)
          console.log(`autodream_runs ${pad(get("autodreamRuns"))}`)
        }
        break
      }

      case "health": {
        const ok = db.isHealthy()
        if (json) {
          printJson({ healthy: ok })
        } else {
          console.log(ok ? "healthy" : "unhealthy")
        }
        if (!ok) process.exit(1)
        break
      }

      case "recent": {
        const raw = rest[0]
        const limit = raw !== undefined ? parseInt(raw, 10) : 10
        if (isNaN(limit) || limit < 1) die("limit must be a positive integer")
        const activity = db.getRecentActivity(limit)
        if (json) {
          printJson(activity)
        } else {
          if (activity.length === 0) {
            console.log("(no recent activity)")
          } else {
            for (const a of activity) {
              console.log(`${a.timestamp}  ${a.type.padEnd(12)}  ${JSON.stringify(a.details)}`)
            }
          }
        }
        break
      }

      case "recall":
      case "search": {
        if (rest.length === 0) die(`usage: smem ${command} <query>`)
        const query = rest.join(" ")
        const results = db.queryMemory(query)
        if (json) {
          printJson(results)
        } else {
          if (results.length === 0) {
            console.log("(no matches)")
          } else {
            for (const r of results) {
              const preview = r.value.length > 120 ? `${r.value.slice(0, 120)}…` : r.value
              console.log(`[${r.session_id}] ${r.key}: ${preview}`)
            }
          }
        }
        break
      }

      // ── Write commands ──────────────────────────────────────────────────────

      case "get-prefs": {
        const user = rest[0] ?? "default"
        const prefs = db.getPreferences(user)
        if (json) {
          printJson(prefs)
        } else {
          if (prefs.length === 0) {
            console.log(`(no preferences for user: ${user})`)
          } else {
            for (const p of prefs) {
              console.log(
                `${p.preference_key.padEnd(32)} = ${String(p.preference_value).padEnd(20)}` +
                  `  [${p.category}, conf=${p.confidence}]`
              )
            }
          }
        }
        break
      }

      case "track-pref": {
        // track-pref <user> <category> <key> <value> [confidence]
        if (rest.length < 4)
          die("usage: smem track-pref <user> <category> <key> <value> [confidence]")
        const [user, category, key, value, conf] = rest
        const confidence = conf !== undefined ? parseFloat(conf) : 0.8
        if (isNaN(confidence) || confidence < 0 || confidence > 1)
          die("confidence must be a number between 0.0 and 1.0")
        db.trackPreference(user, category, key, value, confidence)
        if (json) {
          printJson({ ok: true, user, category, key, value, confidence })
        } else {
          console.log(
            `tracked: ${key} = ${value}  (user=${user}, cat=${category}, conf=${confidence})`
          )
        }
        break
      }

      case "store-context": {
        // store-context <session> <type> <key> <value...>
        if (rest.length < 4) die("usage: smem store-context <session> <type> <key> <value...>")
        const [session, type, key, ...valueParts] = rest
        const value = valueParts.join(" ")
        db.storeContext(session, type, key, value)
        if (json) {
          printJson({ ok: true, session, type, key, value })
        } else {
          console.log(`stored: ${session}/${type}/${key} = ${value}`)
        }
        break
      }

      case "store-interaction": {
        // store-interaction <session> <role> <content...>
        if (rest.length < 3) die("usage: smem store-interaction <session> <role> <content...>")
        const [session, role, ...contentParts] = rest
        const content = contentParts.join(" ")
        db.storeInteraction(session, role, content)
        if (json) {
          printJson({ ok: true, session, role, content })
        } else {
          console.log(`stored: ${role} interaction in session ${session}`)
        }
        break
      }

      default:
        die(`unknown command: ${command}\nRun 'smem --help' for usage.`)
    }
  } finally {
    db.close()
  }
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`smem: error: ${msg}`)
  process.exit(1)
})
