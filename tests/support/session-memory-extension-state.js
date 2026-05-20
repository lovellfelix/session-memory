const state = {
  toolEnabled: true,
  preferences: [],
  contextResponse: '',
  toolCalls: [],
  initializeCalls: 0,
  sessionId: 'session-memory-extension-test',
  initializeError: '',
}

export function resetMockSessionMemoryState() {
  state.toolEnabled = true
  state.preferences = []
  state.contextResponse = ''
  state.toolCalls = []
  state.initializeCalls = 0
  state.sessionId = 'session-memory-extension-test'
  state.initializeError = ''
}

export function setToolEnabled(enabled) {
  state.toolEnabled = enabled
}

export function isToolEnabled() {
  return state.toolEnabled
}

export function setPreferencesResponse(preferences) {
  state.preferences = preferences
}

export function getPreferencesResponse() {
  return state.preferences
}

export function setContextResponse(contextResponse) {
  state.contextResponse = contextResponse
}

export function getContextResponse() {
  return state.contextResponse
}

export function recordToolCall(name, args) {
  state.toolCalls.push({ name, args })
}

export function getToolCalls() {
  return state.toolCalls
}

export function incrementInitializeCalls() {
  state.initializeCalls += 1
}

export function getInitializeCalls() {
  return state.initializeCalls
}

export function setInitializeError(message) {
  state.initializeError = message
}

export function getInitializeError() {
  return state.initializeError
}

export function setSessionId(sessionId) {
  state.sessionId = sessionId
}

export function getSessionId() {
  return state.sessionId
}
