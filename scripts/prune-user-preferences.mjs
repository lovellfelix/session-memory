#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import os from 'os'
import { pathToFileURL } from 'url'

function argValue(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  return process.argv[idx + 1] || null
}

function resolveDefaultDbPath() {
  if (process.env.SESSION_DB) return process.env.SESSION_DB
  if (process.env.SESSION_DB_PATH) return process.env.SESSION_DB_PATH

  const canonicalDbPath = path.join(os.homedir(), '.agents', 'memory', 'session.db')
  const legacyDbPath = path.join(os.homedir(), '.opencode', 'sessions', 'session.db')

  if (fs.existsSync(canonicalDbPath)) return canonicalDbPath
  if (fs.existsSync(legacyDbPath)) return legacyDbPath
  return canonicalDbPath
}

const dbPath = argValue('--db') || resolveDefaultDbPath()
const userId = argValue('--user') || 'default'
const dryRun = process.argv.includes('--dry-run')
const reportPath = argValue('--report')

// Keep-list: stable, namespaced user profile preferences.
const KEEP_KEYS = [
  // identity
  'identity:user_name',
  'identity:handle',
  'identity:preferred_name',
  'identity:nickname',
  'identity:role',
  'identity:domains',
  'identity:environment',
  'identity:zip_code',
  'identity:timezone',

  // style / response
  'style:emoji_level',
  'style:avoid_fluff',
  'style:response_structure',
  'style:tone',
  'response:default_detail',

  // planning / focus
  'planning:work_hours',
  'planning:weekend_mode',
  'planning:weekend_work_policy',
  'planning:holiday_mode',
  'planning:holiday_work_policy',
  'focus:protect_evenings',
  'focus:protect_deep_work',
  'focus:deep_work_window',

  // routing / workflows
  'routing:model_routing',
  'git:commit_message_format',
  'git:pr_base_branch',
  'git:pr_style',
  'code_review:focus',
  'sre:incident_response_protocol',
  'sre:runbook_policy',
  'android:kapt_cache_fix',
]

const distDb = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'database.js')
if (!fs.existsSync(distDb)) {
  console.error(`error: missing ${distDb}. Run: npm run build`)
  process.exit(1)
}

const mod = await import(pathToFileURL(distDb).href)
const { SessionDatabase } = mod

const db = new SessionDatabase(dbPath)
await db.initialize()

if (typeof db.prunePreferences !== 'function') {
  console.error('error: SessionDatabase.prunePreferences() not available; rebuild session-memory')
  process.exit(1)
}

const result = db.prunePreferences(userId, KEEP_KEYS, dryRun)

const report = {
  db: dbPath,
  user_id: userId,
  dry_run: dryRun,
  keep_keys: KEEP_KEYS,
  total: result.total,
  kept: result.kept,
  deleted: result.deleted,
  deleted_keys: result.deletedKeys,
}

if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
}

console.log(JSON.stringify({
  total: result.total,
  kept: result.kept,
  deleted: result.deleted,
  deleted_keys_count: result.deletedKeys.length,
  dry_run: dryRun,
}, null, 2))

db.close()
