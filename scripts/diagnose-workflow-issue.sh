#!/usr/bin/env bash

set -euo pipefail

DOTFILES_ROOT="${DOTFILES_ROOT:-$HOME/.dotfiles}"
SERVER_JS="${DOTFILES_ROOT}/mcp/session-memory/dist/index.js"
CLAUDE_CONFIG="${CLAUDE_CONFIG:-$HOME/Library/Application Support/Claude/claude_desktop_config.json}"
LEGACY_HELPER="${LEGACY_HELPER:-$HOME/.config/opencode/context/mcp-direct-db.sh}"

expand_home_path() {
  local input_path="$1"
  if [[ "$input_path" == "~/"* ]]; then
    printf '%s\n' "$HOME/${input_path#~/}"
  else
    printf '%s\n' "$input_path"
  fi
}

resolve_session_db_path() {
  local explicit_path="${SESSION_MEMORY_DB:-${SESSION_DB:-${SESSION_DB_PATH:-}}}"
  if [[ -n "$explicit_path" ]]; then
    expand_home_path "$explicit_path"
    return
  fi

  local memory_home="${SESSION_MEMORY_HOME:-$HOME/.agents/memory}"
  memory_home="$(expand_home_path "$memory_home")"
  local canonical_db="${memory_home}/session.db"
  local legacy_db="$HOME/.opencode/sessions/session.db"

  if [[ -f "$canonical_db" ]]; then
    printf '%s\n' "$canonical_db"
    return
  fi

  if [[ -f "$legacy_db" ]]; then
    printf '%s\n' "$legacy_db"
    return
  fi

  printf '%s\n' "$canonical_db"
}

SESSION_DB="$(resolve_session_db_path)"
SESSION_MEMORY_DB="${SESSION_MEMORY_DB:-$SESSION_DB}"
export SESSION_DB SESSION_MEMORY_DB

failures=0
warnings=0

pass() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; warnings=$((warnings + 1)); }
fail() { echo "❌ $*"; failures=$((failures + 1)); }

echo "=== Session Memory MCP Diagnostic ==="
echo "DOTFILES_ROOT: $DOTFILES_ROOT"
echo "SERVER_JS: $SERVER_JS"
echo "SESSION_DB: $SESSION_DB"
echo

echo "1) Node runtime"
if command -v node >/dev/null 2>&1; then
  pass "node found: $(command -v node)"
  pass "node version: $(node --version)"
else
  fail "node not found in PATH"
fi
echo

echo "2) MCP server build artifact"
if [[ -f "$SERVER_JS" ]]; then
  pass "server dist file exists"
else
  if [[ "${SESSION_MEMORY_DIAG_BUILD:-0}" == "1" ]]; then
    warn "server dist missing; opt-in build enabled (SESSION_MEMORY_DIAG_BUILD=1)"
    if npm --prefix "$DOTFILES_ROOT/mcp/session-memory" run build >/dev/null 2>&1 && [[ -f "$SERVER_JS" ]]; then
      pass "build succeeded; dist file created"
    else
      fail "server dist missing after opt-in build"
    fi
  else
    fail "server dist missing. Build manually: npm --prefix \"$DOTFILES_ROOT/mcp/session-memory\" run build (or set SESSION_MEMORY_DIAG_BUILD=1)"
  fi
fi
echo

echo "3) Optional Claude Desktop config presence"
if [[ -f "$CLAUDE_CONFIG" ]]; then
  pass "Claude Desktop config exists"
  if command -v node >/dev/null 2>&1; then
    claude_status="$(node - "$CLAUDE_CONFIG" "$SERVER_JS" <<'NODE'
const fs = require('fs')
const path = require('path')

const configPath = process.argv[2]
const repoServerPath = path.resolve(process.argv[3])

try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const server = config?.mcpServers?.['session-memory']
  if (!server) {
    console.log('missing_server')
    process.exit(0)
  }

  const args = Array.isArray(server.args) ? server.args : []
  const resolvedArgs = args
    .filter((arg) => typeof arg === 'string')
    .map((arg) => (arg.startsWith('~/') ? path.join(process.env.HOME || '', arg.slice(2)) : path.resolve(arg)))

  if (resolvedArgs.includes(repoServerPath)) {
    console.log('repo_server')
    process.exit(0)
  }

  if (args.some((arg) => typeof arg === 'string' && arg.includes('dist/index.js'))) {
    console.log('dist_arg')
    process.exit(0)
  }

  console.log('other_server')
} catch {
  console.log('parse_error')
}
NODE
)"
    case "$claude_status" in
    repo_server)
      pass "Claude config has session-memory server pointing to this repo dist/index.js"
      ;;
    dist_arg)
      pass "Claude config has session-memory server with dist/index.js argument"
      ;;
    missing_server)
      warn "Claude config missing mcpServers['session-memory']"
      ;;
    other_server)
      warn "Claude config has session-memory server, but args do not point to this repo server path"
      ;;
    *)
      warn "Claude config could not be parsed as valid JSON"
      ;;
    esac
  else
    warn "Skipping Claude config JSON probe because node is unavailable"
  fi
else
  warn "Claude Desktop config not found"
fi
echo

echo "4) Session DB availability"
if command -v sqlite3 >/dev/null 2>&1; then
  if [[ -f "$SESSION_DB" ]]; then
    pass "session DB exists"
    if sqlite3 "$SESSION_DB" '.tables' >/tmp/session-memory-tables.$$ 2>/tmp/session-memory-sqlite-err.$$; then
      table_count="$(tr ' ' '\n' </tmp/session-memory-tables.$$ | sed '/^$/d' | wc -l | tr -d ' ')"
      pass "sqlite readable; tables discovered: ${table_count}"
    else
      fail "sqlite cannot read session DB"
    fi
    rm -f /tmp/session-memory-tables.$$ /tmp/session-memory-sqlite-err.$$
  else
    fail "session DB not found"
  fi
else
  fail "sqlite3 not found in PATH"
fi
echo

echo "5) JSON-RPC startup check (initialize + tools/list)"
if [[ -f "$SERVER_JS" ]] && command -v node >/dev/null 2>&1; then
  jsonrpc_out="$(mktemp -t session-memory-jsonrpc.XXXXXX)"
  jsonrpc_err="$(mktemp -t session-memory-jsonrpc-err.XXXXXX)"
  if SESSION_DB="$SESSION_DB" SESSION_MEMORY_DB="$SESSION_MEMORY_DB" node "$DOTFILES_ROOT/mcp/session-memory/scripts/diagnose-jsonrpc.mjs" "$SERVER_JS" >"$jsonrpc_out" 2>"$jsonrpc_err"; then
    pass "JSON-RPC initialize/tools/list succeeded"
    tools_line=""
    if [[ -f "$jsonrpc_out" ]]; then
      tools_line="$(grep '^tools=' "$jsonrpc_out" || true)"
    fi
    if [[ -n "$tools_line" ]]; then
      pass "${tools_line}"
    fi
  else
    fail "JSON-RPC startup check failed"
    if [[ -s "$jsonrpc_err" ]]; then
      warn "See stderr: $jsonrpc_err"
    fi
  fi
  rm -f "$jsonrpc_out" "$jsonrpc_err"
fi
echo

echo "6) Optional legacy helper"
if [[ -f "$LEGACY_HELPER" ]]; then
  pass "legacy helper present: $LEGACY_HELPER"
  # shellcheck disable=SC1090
  if source "$LEGACY_HELPER" >/dev/null 2>&1; then
    pass "legacy helper sourceable"
  else
    warn "legacy helper exists but failed to source"
  fi
else
  warn "legacy helper not present (optional)"
fi
echo

echo "=== Summary ==="
echo "Warnings: $warnings"
if (( failures > 0 )); then
  echo "Failures: $failures"
  exit 1
fi

echo "Failures: 0"
exit 0
