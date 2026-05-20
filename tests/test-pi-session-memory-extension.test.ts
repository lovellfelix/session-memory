import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import * as ts from 'typescript'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const createdDirs: string[] = []

type BeforeAgentStartHook = (
  event: { prompt: string },
  ctx: { hasUI: boolean; sessionManager: { getSessionFile: () => string } }
) => Promise<{ message: { content: string; customType: string; display: boolean } } | undefined>

type StateModule = typeof import('./support/session-memory-extension-state.js')

function buildExtensionModuleSource() {
  const extensionPath = path.resolve(
    __dirname,
    '../../../pi/.pi/agent/extensions/session-memory-mcp/index.ts',
  )
  const sessionMemoryMockPath = path.resolve(__dirname, './support/session-memory.shared.mock.js')
  const mcpStateMockPath = path.resolve(__dirname, './support/mcp-state.mock.js')
  const source = readFileSync(extensionPath, 'utf8')

  return source
    .replace(/^import type { ExtensionAPI } from "@mariozechner\/pi-coding-agent"\n/m, '')
    .replace(
      /^import { StringEnum } from "@mariozechner\/pi-ai"\n/m,
      'const StringEnum = values => values\n',
    )
    .replace(
      /^import { Type } from "@sinclair\/typebox"\n/m,
      'const Type = { Object: value => value, Optional: value => value, String: value => value ?? {}, Number: value => value ?? {}, Boolean: value => value ?? {} }\n',
    )
    .replace(
      /import\s*{\s*SessionMemoryClient,\s*buildSessionId,\s*getSessionMemoryPaths,\s*safeJsonParse,\s*truncateText,\s*}\s*from "\.\.\/shared\/session-memory\.ts"\n/m,
      `import { SessionMemoryClient, buildSessionId, getSessionMemoryPaths, safeJsonParse, truncateText } from ${JSON.stringify(pathToFileURL(sessionMemoryMockPath).href)}\n`,
    )
    .replace(
      /^import { isMcpToolEnabled } from "\.\.\/shared\/mcp-state\.ts"\n/m,
      `import { isMcpToolEnabled } from ${JSON.stringify(pathToFileURL(mcpStateMockPath).href)}\n`,
    )
}

async function loadBeforeAgentStart() {
  jest.resetModules()

  const state = (await import('./support/session-memory-extension-state.js')) as StateModule
  state.resetMockSessionMemoryState()

  const transpiled = ts.transpileModule(buildExtensionModuleSource(), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  })

  const tempDir = mkdtempSync(path.join(tmpdir(), 'pi-session-memory-extension-'))
  createdDirs.push(tempDir)
  const modulePath = path.join(tempDir, 'session-memory-extension.mjs')
  writeFileSync(modulePath, transpiled.outputText)

  const hooks = new Map<string, BeforeAgentStartHook>()
  const pi = {
    on(event: string, handler: BeforeAgentStartHook) {
      hooks.set(event, handler)
    },
    registerTool: jest.fn(),
  }

  const { default: registerExtension } = await import(pathToFileURL(modulePath).href)
  registerExtension(pi as never)

  const beforeAgentStart = hooks.get('before_agent_start')
  if (!beforeAgentStart) throw new Error('before_agent_start hook not registered')

  return { beforeAgentStart, state }
}

function createContext() {
  return {
    hasUI: false,
    sessionManager: {
      getSessionFile: () => '/tmp/session-memory-extension-test.json',
    },
  }
}

describe('Pi session-memory extension', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
    jest.restoreAllMocks()
  })

  it('injects compact user preferences on non-continuity prompts', async () => {
    const { beforeAgentStart, state } = await loadBeforeAgentStart()
    state.setPreferencesResponse([
      {
        category: 'identity',
        preference_key: 'preferred_name',
        preference_value: 'Lovell',
      },
      {
        category: 'workflow',
        preference_key: 'output_style',
        preference_value: 'Concise bullets',
      },
    ])
    state.setContextResponse('Assembled continuity context')

    const result = await beforeAgentStart({ prompt: 'inspect the current diff' }, createContext())

    expect(result).toBeDefined()
    expect(result?.message.customType).toBe('session-memory-mcp')
    expect(result?.message.display).toBe(false)
    expect(result?.message.content).toContain('User preferences:')
    expect(result?.message.content).toContain('[identity] preferred_name: Lovell')
    expect(result?.message.content).toContain('[workflow] output_style: Concise bullets')
    expect(result?.message.content).not.toContain('Assembled continuity context')

    const assembleCalls = state.getToolCalls().filter(call => call.name === 'assemble_active_context')
    expect(assembleCalls).toHaveLength(0)
    expect(state.getInitializeCalls()).toBe(1)
  })

  it('injects preferences plus assembled active context on continuity prompts', async () => {
    const { beforeAgentStart, state } = await loadBeforeAgentStart()
    state.setPreferencesResponse([
      {
        category: 'identity',
        preference_key: 'preferred_name',
        preference_value: 'Lovell',
      },
    ])
    state.setContextResponse('Assembled continuity context')
    state.setSessionId('resume-session-123')

    const prompt = 'resume work on the portability plan'
    const result = await beforeAgentStart({ prompt }, createContext())

    expect(result).toBeDefined()
    expect(result?.message.content).toContain('User preferences:')
    expect(result?.message.content).toContain('Assembled continuity context')

    const assembleCalls = state.getToolCalls().filter(call => call.name === 'assemble_active_context')
    expect(assembleCalls).toHaveLength(1)
    expect(assembleCalls[0]).toMatchObject({
      args: {
        query: prompt,
        session_id: 'resume-session-123',
        limit: 4,
      },
    })
  })

  it('reuses cached preferences across non-continuity prompts', async () => {
    const { beforeAgentStart, state } = await loadBeforeAgentStart()
    state.setPreferencesResponse([
      {
        category: 'identity',
        preference_key: 'preferred_name',
        preference_value: 'Lovell',
      },
    ])

    await beforeAgentStart({ prompt: 'inspect the current diff' }, createContext())
    await beforeAgentStart({ prompt: 'inspect another diff' }, createContext())

    const preferenceCalls = state.getToolCalls().filter(call => call.name === 'get_user_preferences')
    expect(preferenceCalls).toHaveLength(2)
  })

  it('keeps recently updated preferences inside the compact injection budget', async () => {
    const { beforeAgentStart, state } = await loadBeforeAgentStart()
    const oldPreferences = Array.from({ length: 13 }, (_, index) => ({
      category: 'general',
      preference_key: `old_${index}`,
      preference_value: `Old preference ${index}`,
      confidence: 1,
      updated_at: '2026-01-01 00:00:00',
    }))
    state.setPreferencesResponse([
      ...oldPreferences,
      {
        category: 'workflow',
        preference_key: 'output_style',
        preference_value: 'Concise bullets',
        confidence: 0.8,
        updated_at: '2026-05-01 00:00:00',
      },
    ])

    const result = await beforeAgentStart({ prompt: 'inspect the current diff' }, createContext())

    expect(result?.message.content).toContain('[workflow] output_style: Concise bullets')
    expect(result?.message.content).not.toContain('[general] old_12')
  })

  it('fails open with an init retry cooldown when session-memory startup fails', async () => {
    const { beforeAgentStart, state } = await loadBeforeAgentStart()
    state.setInitializeError('startup failed')

    const first = await beforeAgentStart({ prompt: 'inspect the current diff' }, createContext())
    const second = await beforeAgentStart({ prompt: 'inspect another diff' }, createContext())

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(state.getInitializeCalls()).toBe(1)
    expect(state.getToolCalls()).toHaveLength(0)
  })
})
