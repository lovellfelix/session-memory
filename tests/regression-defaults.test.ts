import { afterEach, describe, expect, it } from '@jest/globals'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import * as ts from 'typescript'
import { SessionDatabase } from '../src/database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const createdDirs: string[] = []

async function createDatabase() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'session-memory-db-'))
  createdDirs.push(tempDir)
  const db = new SessionDatabase(path.join(tempDir, 'session.db'))
  await db.initialize()
  return db
}

async function loadSessionMemoryClient() {
  const sourcePath = path.resolve(__dirname, '../../../pi/.pi/agent/extensions/shared/session-memory.ts')
  const source = readFileSync(sourcePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  })

  const tempDir = mkdtempSync(path.join(tmpdir(), 'session-memory-shared-'))
  createdDirs.push(tempDir)
  const modulePath = path.join(tempDir, 'session-memory-shared.mjs')
  writeFileSync(modulePath, transpiled.outputText)

  return import(pathToFileURL(modulePath).href)
}

describe('session-memory regressions', () => {
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 100))

    while (createdDirs.length > 0) {
      const dir = createdDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to LOG_LEVEL when session-memory env vars are unset', async () => {
    const original = {
      SESSION_MEMORY_LOG_LEVEL: process.env.SESSION_MEMORY_LOG_LEVEL,
      SESSION_MEMORY_DEBUG: process.env.SESSION_MEMORY_DEBUG,
      SESSION_MEMORY_VERBOSE: process.env.SESSION_MEMORY_VERBOSE,
      LOG_LEVEL: process.env.LOG_LEVEL,
    }

    delete process.env.SESSION_MEMORY_LOG_LEVEL
    delete process.env.SESSION_MEMORY_DEBUG
    delete process.env.SESSION_MEMORY_VERBOSE
    process.env.LOG_LEVEL = 'warn'

    try {
      const { SessionMemoryClient } = await loadSessionMemoryClient()
      const client = new SessionMemoryClient('/tmp/server.js', '/tmp/session.db') as any
      expect(client.getSessionMemoryLogLevel()).toBe('warn')
    } finally {
      process.env.SESSION_MEMORY_LOG_LEVEL = original.SESSION_MEMORY_LOG_LEVEL
      process.env.SESSION_MEMORY_DEBUG = original.SESSION_MEMORY_DEBUG
      process.env.SESSION_MEMORY_VERBOSE = original.SESSION_MEMORY_VERBOSE
      process.env.LOG_LEVEL = original.LOG_LEVEL
    }
  })

  it('preserves explicit 0 values in routing and preference defaults', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8')

    expect(source).toContain('confidence: args.confidence ?? 1.0')
    expect(source).toContain('args.confidence ?? 1.0')
    expect(source).toContain('args.min_confidence ?? 0.7')
    expect(source).toContain('args.file_count ?? 0')
    expect(source).toContain('args.loc_estimate ?? 0')
    expect(source).toContain('limit: args.limit ?? 5')
  })

  it('preserves an explicit 0 limit in findSimilarRoutingPatterns', async () => {
    const db = await createDatabase()

    for (let i = 0; i < 6; i += 1) {
      db.storeRoutingPattern(`pattern-${i}`, `agent-${i}`, 0.9, 1, 1)
    }

    const patterns = db.findSimilarRoutingPatterns('a b c', { minConfidence: 0, limit: 0 })

    expect(patterns).toHaveLength(0)
  })

  it('preserves an explicit 0 minConfidence in findSimilarRoutingPatterns', async () => {
    const db = await createDatabase()

    db.storeRoutingPattern('alpha-pattern', 'agent-alpha', 0.2, 1, 1)

    const patterns = db.findSimilarRoutingPatterns('alpha route', { minConfidence: 0, limit: 5 })

    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.pattern_key).toBe('alpha-pattern')
  })
})
