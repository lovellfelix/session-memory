import { isToolEnabled } from './session-memory-extension-state.js'

export function isMcpToolEnabled(name) {
  return name === 'session_memory' ? isToolEnabled() : false
}
