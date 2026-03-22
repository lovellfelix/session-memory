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
const outPath = argValue('--out') || path.join(os.homedir(), '.config', 'opencode', 'user-profile.json')
const userId = argValue('--user') || 'default'

const distDb = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'database.js')
if (!fs.existsSync(distDb)) {
  console.error(`error: missing ${distDb}. Run: npm run build`)
  process.exit(1)
}

const mod = await import(pathToFileURL(distDb).href)
const { SessionDatabase } = mod

const db = new SessionDatabase(dbPath)
await db.initialize()
const prefs = db.getPreferences(userId)

const get = (k) => {
  const row = prefs.find(p => String(p.preference_key) === k)
  return row ? String(row.preference_value) : null
}

// Normalize time strings into HH:MM-HH:MM
function normalizeHours(v) {
  if (!v) return null
  const s = String(v).trim()
  // Already canonical
  if (/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(s)) return s
  // 9-17 or 9:00-17:00 or with en-dash
  const cleaned = s.replace(/–/g, '-').replace(/\s+/g, '')
  const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/)
  if (!m) return s
  const sh = String(m[1]).padStart(2, '0')
  const sm = String(m[2] || '00')
  const eh = String(m[3]).padStart(2, '0')
  const em = String(m[4] || '00')
  return `${sh}:${sm}-${eh}:${em}`
}

// Prefer full human name for identity:user_name; keep handle separately.
const handle = get('identity:user_name') || get('user_name') || null
const fullName = get('identity:real_name') || get('identity:user_name') || get('real_name') || get('user_name') || null

const profile = {
  identity: {
    user_name: fullName,
    handle: handle,
    preferred_name: get('identity:preferred_name') || get('preferred_name') || get('name') || null,
    nickname: get('identity:nickname') || get('nickname') || null,
    role: get('identity:role') || get('user_role') || get('role') || null,
    domains: get('identity:domains') || get('domains') || null,
    environment: get('identity:environment') || get('environment') || null,
    zip_code: get('identity:zip_code') || get('zip_code') || null,
    timezone: get('identity:timezone') || get('timezone') || null,
  },
  style: {
    emoji_level: get('style:emoji_level') || get('emoji_level') || null,
    avoid_fluff: get('style:avoid_fluff') || get('avoid_fluff') || null,
    response_structure: get('style:response_structure') || get('response_structure') || null,
    tone: get('style:tone') || get('response_tone') || null,
  },
  response: {
    default_detail: get('response:default_detail') || null,
  },
  planning: {
    work_hours: normalizeHours(get('planning:work_hours') || get('work_hours') || get('identity:work_hours')),
    weekend_mode: get('planning:weekend_mode') || get('weekend_mode') || null,
    weekend_work_policy: get('planning:weekend_work_policy') || get('weekend_work_policy') || null,
    holiday_mode: get('planning:holiday_mode') || get('holiday_mode') || null,
    holiday_work_policy: get('planning:holiday_work_policy') || get('holiday_work_policy') || null,
  },
  focus: {
    protect_evenings: get('focus:protect_evenings') || get('protect_evenings') || null,
    protect_deep_work: get('focus:protect_deep_work') || get('protect_deep_work') || null,
    deep_work_window: normalizeHours(get('focus:deep_work_window') || null),
  },
  routing: {
    model_routing: get('routing:model_routing') || get('model_routing') || null,
  },
  git: {
    commit_message_format: get('git:commit_message_format') || null,
    pr_base_branch: get('git:pr_base_branch') || null,
    pr_style: get('git:pr_style') || get('github:pr_style') || get('github.pr_style') || null,
  },
  code_review: {
    focus: get('code_review:focus') || get('code_review_preferences') || null,
  },
  sre: {
    incident_response_protocol: get('sre:incident_response_protocol') || null,
    runbook_policy: get('sre:runbook_policy') || null,
  },
  android: {
    kapt_cache_fix: get('android:kapt_cache_fix') || null,
  },
}

// Drop null/empty strings
function prune(obj) {
  if (!obj || typeof obj !== 'object') return obj
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      prune(v)
      if (Object.keys(v).length === 0) delete obj[k]
    } else if (v === null || v === '' || v === 'deprecated') {
      delete obj[k]
    }
  }
  return obj
}

prune(profile)

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(profile, null, 2) + '\n', 'utf8')
console.log(outPath)

db.close()
