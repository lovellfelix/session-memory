import {
  getContextResponse,
  getPreferencesResponse,
  getInitializeError,
  getSessionId,
  incrementInitializeCalls,
  recordToolCall,
} from './session-memory-extension-state.js'

export class SessionMemoryClient {
  constructor(_serverPath, _sessionDb) {}

  async initialize() {
    incrementInitializeCalls()
    const error = getInitializeError()
    if (error) throw new Error(error)
  }

  async callTool(name, args) {
    recordToolCall(name, args)

    switch (name) {
      case 'get_user_preferences':
        return JSON.stringify(getPreferencesResponse())
      case 'assemble_active_context':
        return getContextResponse()
      case 'track_user_preference':
        return 'tracked'
      default:
        return ''
    }
  }

  async stop() {}
}

export function buildSessionId(_ctx) {
  return getSessionId()
}

export function getSessionMemoryPaths() {
  return {
    dotfilesRoot: '/tmp/dotfiles',
    serverPath: '/tmp/dotfiles/mcp/session-memory/dist/index.js',
    sessionDb: '/tmp/session-memory.db',
  }
}

export function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[truncated]`
}

export function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}
