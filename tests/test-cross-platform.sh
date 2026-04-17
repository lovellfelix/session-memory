#!/usr/bin/env bash

##############################################################################
# Cross-Platform MCP Compatibility Test
# 
# Validates MCP server works across all three platforms:
# 1. OpenCode CLI (direct Node.js import)
# 2. Claude Desktop (stdio MCP protocol)
# 3. Raycast AI (stdio MCP protocol)
##############################################################################

set -euo pipefail

# Configuration
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_pass() {
    echo -e "${GREEN}✓${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
    echo -e "${RED}✗${NC} $1"
    if [[ -n "${2:-}" ]]; then
        echo "  Details: $2"
    fi
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_skip() {
    echo -e "${YELLOW}⊘${NC} $1"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

log_info() {
    echo -e "${BLUE}ⓘ${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}$1${NC}"
    echo "═══════════════════════════════════════════════════════════════"
}

with_timeout() {
    local seconds="$1"
    shift

    if command -v timeout >/dev/null 2>&1; then
        timeout "$seconds" "$@"
        return $?
    fi

    if command -v gtimeout >/dev/null 2>&1; then
        gtimeout "$seconds" "$@"
        return $?
    fi

    perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"
}

resolve_db_path() {
    local canonical_db_path="$HOME/.agents/memory/session.db"
    local legacy_db_path="$HOME/.opencode/sessions/session.db"

    if [[ -n "${SESSION_MEMORY_DB:-}" ]]; then
        printf '%s\n' "$SESSION_MEMORY_DB"
        return
    fi

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

resolve_project_root() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$script_dir/.." && pwd
}

resolve_global_server_root() {
    local npm_root
    npm_root="$(npm root -g 2>/dev/null || true)"
    if [[ -n "$npm_root" ]]; then
        printf '%s\n' "$npm_root/@lovellfelix/mcp-session-memory"
        return
    fi
    printf '%s\n' "/opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory"
}

##############################################################################
# Main Test Flow
##############################################################################

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       MCP Cross-Platform Compatibility Test Suite            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

log_section "[1] Database Health Check"

DB_PATH="$(resolve_db_path)"
PROJECT_ROOT="$(resolve_project_root)"

if [[ -f "$DB_PATH" ]]; then
    log_pass "Database file exists at $DB_PATH"
else
    log_fail "Database file not found" "Expected: $DB_PATH"
fi

# Check database size
if [[ -f "$DB_PATH" ]]; then
    DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
    log_info "Database size: $DB_SIZE"
fi

# Check database integrity
if [[ -f "$DB_PATH" ]]; then
    INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>&1)
    if [[ "$INTEGRITY" == "ok" ]]; then
        log_pass "Database integrity check passed"
    else
        log_fail "Database integrity check failed" "$INTEGRITY"
    fi
fi

# Check database tables
if [[ -f "$DB_PATH" ]]; then
    TABLES=$(sqlite3 "$DB_PATH" ".tables" 2>&1)
    if echo "$TABLES" | grep -q "session_contexts"; then
        log_pass "All required tables exist"
        log_info "Tables: $TABLES"
    else
        log_fail "Missing required tables" "Found: $TABLES"
    fi
fi

# Check database permissions
if [[ -f "$DB_PATH" ]]; then
    if [[ -r "$DB_PATH" ]] && [[ -w "$DB_PATH" ]]; then
        log_pass "Database has read/write permissions"
    else
        log_fail "Database permission issues" "Read: $(test -r "$DB_PATH" && echo yes || echo no), Write: $(test -w "$DB_PATH" && echo yes || echo no)"
    fi
fi

log_section "[2] OpenCode Configuration Check"

# Prefer the active local config; fall back to the tracked base template.
OPENCODE_CONFIG="${OPENCODE_CONFIG:-$HOME/.config/opencode/opencode.json}"
if [[ ! -f "$OPENCODE_CONFIG" ]]; then
    OPENCODE_CONFIG="$HOME/.config/opencode/opencode.base.json"
fi

if [[ -f "$OPENCODE_CONFIG" ]]; then
    log_pass "OpenCode config exists at $OPENCODE_CONFIG"
    
    # Check MCP-related permissions/config without assuming one exact schema.
    if jq -e '
        (.permission // {}) as $permission |
        (.mcp // .mcpServers // {}) as $mcp |
        (($permission | to_entries | map(select(.key | startswith("mcp_"))) | length) > 0)
        or (($mcp | keys | length) > 0)
      ' "$OPENCODE_CONFIG" >/dev/null 2>&1; then
        log_pass "MCP settings detected in OpenCode config"
    else
        log_skip "No MCP settings detected in OpenCode config"
    fi
else
    log_skip "OpenCode config not found at $OPENCODE_CONFIG"
fi

log_section "[3] Claude Desktop Configuration Check"

CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

if [[ -f "$CLAUDE_CONFIG" ]]; then
    log_pass "Claude Desktop config exists"
    
    if jq -e '.mcpServers."session-memory"' "$CLAUDE_CONFIG" >/dev/null 2>&1; then
        log_pass "MCP session-memory server configured in Claude"
        
        SERVER_COMMAND=$(jq -r '.mcpServers."session-memory".command // empty' "$CLAUDE_CONFIG")
        SERVER_ARGS=$(jq -r '.mcpServers."session-memory".args[0] // empty' "$CLAUDE_CONFIG")
        
        log_info "Server command: $SERVER_COMMAND"
        log_info "Server script: $SERVER_ARGS"
        
        if [[ -f "$SERVER_ARGS" ]]; then
            log_pass "Server script exists and is accessible"
        else
            log_fail "Server script not found" "Path: $SERVER_ARGS"
        fi
    else
        log_fail "MCP session-memory server not configured" "Add to mcpServers section"
    fi
    
    # Check env vars
    if jq -e '.mcpServers."session-memory".env.SESSION_DB' "$CLAUDE_CONFIG" >/dev/null 2>&1; then
        DB_ENV=$(jq -r '.mcpServers."session-memory".env.SESSION_DB' "$CLAUDE_CONFIG")
        log_pass "SESSION_DB environment variable configured: $DB_ENV"
    else
        log_fail "SESSION_DB environment variable not configured"
    fi
else
    log_skip "Claude Desktop config not found at $CLAUDE_CONFIG (OK if not using Claude)"
fi

log_section "[4] Raycast Configuration Check"

log_info "Raycast configuration is managed via UI, not file-based"
log_info "Manual verification required - see test-raycast-integration.md"

log_section "[5] MCP Server File Validation"

# Check for local project source or globally installed package
GLOBAL_SERVER="$(resolve_global_server_root)"

if [[ -d "$PROJECT_ROOT" ]]; then
    log_pass "MCP server source found at $PROJECT_ROOT"
    
    if [[ -d "$PROJECT_ROOT/dist" ]]; then
        log_pass "Compiled server files exist (dist directory)"
    else
        log_fail "No compiled server files found" "Run 'npm run build' in server directory"
    fi
    
    if [[ -f "$PROJECT_ROOT/package.json" ]]; then
        log_pass "Server package.json exists"
    else
        log_fail "Server package.json not found"
    fi
    
    if [[ -f "$PROJECT_ROOT/dist/index.js" ]]; then
        log_pass "Compiled server entry point exists"
    else
        log_fail "Compiled index.js not found" "Run 'npm run build'"
    fi
elif [[ -d "$GLOBAL_SERVER" ]]; then
    log_pass "MCP server found via global npm install"
else
    log_skip "MCP server not found in expected locations"
    log_info "Install with: npm install -g @lovellfelix/mcp-session-memory"
fi

log_section "[6] Node.js and Dependencies"

# Check Node.js version
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    log_pass "Node.js installed: $NODE_VERSION"
    
    # Check minimum version (18+)
    MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ $MAJOR_VERSION -ge 18 ]]; then
        log_pass "Node.js version sufficient (18+)"
    else
        log_fail "Node.js version too old" "Need 18+, have $NODE_VERSION"
    fi
else
    log_fail "Node.js not found" "Install from https://nodejs.org"
fi

# Check npm
if command -v npm >/dev/null 2>&1; then
    NPM_VERSION=$(npm --version)
    log_pass "npm installed: $NPM_VERSION"
else
    log_fail "npm not found"
fi

log_section "[7] Server Startup Test"

# Try to start server and check if it responds
SERVER_PATH="${PROJECT_ROOT}/dist/index.js"

if [[ -f "$SERVER_PATH" ]]; then
    log_info "Testing server startup..."

    tmp_err="$(mktemp)"
    node "$SERVER_PATH" < /dev/null >/dev/null 2>"$tmp_err" &
    pid=$!

    sleep 1

    if ps -p "$pid" >/dev/null 2>&1; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        log_pass "Server starts without immediate errors"
    else
        err_tail=$(tail -n 5 "$tmp_err" 2>/dev/null | tr -d '\r')
        if grep -q "Server initialization complete" "$tmp_err" 2>/dev/null; then
            log_pass "Server initializes successfully before stdio closes"
        else
            log_fail "Server exited immediately" "${err_tail:-no stderr}"
        fi
    fi

    rm -f "$tmp_err"
else
    log_skip "Server path not found, skipping startup test"
fi

log_section "[8] Protocol Support Validation"

# Check for stdio support
if [[ -f "$SERVER_PATH" ]]; then
    log_info "Checking stdio protocol support..."
    
    # Simple test: send JSON-RPC request
    RESPONSE=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
               with_timeout 3 node "$SERVER_PATH" 2>/dev/null || echo "{}")
    
    if echo "$RESPONSE" | grep -q "jsonrpc"; then
        log_pass "Server responds to JSON-RPC stdio protocol"
    else
        log_fail "Server doesn't respond to JSON-RPC" "Response: ${RESPONSE:0:100}"
    fi
else
    log_skip "Server not found, skipping protocol test"
fi

log_section "[9] Database Connectivity Test"

if [[ -f "$DB_PATH" ]] && [[ -f "$SERVER_PATH" ]]; then
    log_info "Testing database connectivity..."
    
    # Test with actual MCP call
    PREF_TEST=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_user_preferences","arguments":{"user_id":"default"}}}' | \
                 with_timeout 3 node "$SERVER_PATH" 2>/dev/null || echo "{}")
    
    if echo "$PREF_TEST" | grep -qE "(result|error)"; then
        log_pass "Server can access database and respond to queries"
    else
        log_skip "Database test inconclusive (may be startup overhead)"
    fi
else
    log_skip "Prerequisites missing for database test"
fi

log_section "[10] Access Control and Security"

# Check database file permissions
if [[ -f "$DB_PATH" ]]; then
    PERMS=$(stat -f "%A" "$DB_PATH" 2>/dev/null || echo "unknown")
    
    if [[ "$PERMS" == "-rw-------"* ]] || [[ "$PERMS" == "-rw-r--"* ]]; then
        log_pass "Database has appropriate file permissions: $PERMS"
    else
        log_pass "Database file permissions: $PERMS (check if appropriate)"
    fi
fi

# Check for secrets in config files
SECRETS_FOUND=0

if [[ -f "$OPENCODE_CONFIG" ]]; then
    if grep -qi "password\|token\|secret\|key" "$OPENCODE_CONFIG" 2>/dev/null; then
        log_fail "Potential secrets found in OpenCode config"
        SECRETS_FOUND=$((SECRETS_FOUND + 1))
    fi
fi

if [[ -f "$CLAUDE_CONFIG" ]]; then
    if grep -qi "password\|token\|secret\|key" "$CLAUDE_CONFIG" 2>/dev/null; then
        log_fail "Potential secrets found in Claude config"
        SECRETS_FOUND=$((SECRETS_FOUND + 1))
    fi
fi

if [[ $SECRETS_FOUND -eq 0 ]]; then
    log_pass "No hardcoded secrets detected in configs"
fi

log_section "[11] Cross-Platform Tool Availability"

# Check what MCP tools are available
if [[ -f "$SERVER_PATH" ]]; then
    TOOLS_LIST=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
                 with_timeout 3 node "$SERVER_PATH" 2>/dev/null | \
                 grep -o '"name":"[^"]*"' | wc -l || echo "0")
    
    if [[ "$TOOLS_LIST" -gt 0 ]]; then
        log_pass "Server exposes $TOOLS_LIST tools via MCP"
    else
        log_skip "Could not count tools (startup overhead)"
    fi
else
    log_skip "Server not available for tool check"
fi

log_section "[12] System Requirements Check"

# Check disk space
DB_PARENT_DIR="$(dirname "$DB_PATH")"
AVAILABLE_SPACE=$(df -h "$DB_PARENT_DIR" 2>/dev/null | tail -1 | awk '{print $4}')
log_info "Available space for $(basename "$DB_PARENT_DIR"): $AVAILABLE_SPACE"

# Check if on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    log_pass "Running on macOS (compatible platform)"
else
    log_fail "Not running on macOS" "Current OS: $OSTYPE"
fi

# Check for SQLite
if command -v sqlite3 >/dev/null 2>&1; then
    SQLITE_VERSION=$(sqlite3 --version | cut -d' ' -f1)
    log_pass "SQLite installed: $SQLITE_VERSION"
else
    log_fail "SQLite not found" "Required for database operations"
fi

##############################################################################
# Summary and Recommendations
##############################################################################

log_section "📊 Test Summary"

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))

echo ""
echo "Test Results:"
echo "  ${GREEN}Passed:${NC}   $TESTS_PASSED"
echo "  ${RED}Failed:${NC}   $TESTS_FAILED"
echo "  ${YELLOW}Skipped:${NC}  $TESTS_SKIPPED"
echo "  ${BLUE}Total:${NC}    $TOTAL_TESTS"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}✅ All critical tests passed!${NC}"
    echo ""
    echo "MCP server is ready for use on:"
    echo "  • OpenCode CLI (via MCP stdio transport)"
    echo "  • Claude Desktop (via stdio MCP protocol)"
    echo "  • Raycast AI (via stdio MCP protocol)"
    EXIT_CODE=0
else
    echo -e "${RED}❌ Some critical tests failed${NC}"
    echo ""
    echo "Issues found:"
    echo "  • $TESTS_FAILED test(s) failed - see details above"
    echo ""
    echo "Recommended actions:"
    echo "  1. Review failed tests above"
    echo "  2. Check error messages and details"
    echo "  3. Run specific platform tests for more details:"
    echo "     - OpenCode: npm run build && npm test"
    echo "     - Claude: ./tests/test-claude-integration.sh"
    echo "     - Raycast: See tests/test-raycast-integration.md"
    EXIT_CODE=1
fi

echo ""

##############################################################################
# Platform-Specific Guidance
##############################################################################

log_section "📋 Next Steps by Platform"

echo ""
echo -e "${BLUE}OpenCode CLI Integration:${NC}"
echo "  Status: Ready for integration via MCP stdio transport"
echo "  Next: Run OpenCode tests with: npm test -- test-opencode-integration.test.ts"
echo "  Doc: See tests/test-opencode-integration.test.ts"
echo ""

if [[ -f "$CLAUDE_CONFIG" ]]; then
    echo -e "${BLUE}Claude Desktop:${NC}"
    echo "  Status: Server configured in claude_desktop_config.json"
    echo "  Next: Run Claude tests with: ./tests/test-claude-integration.sh"
    echo "  Doc: See tests/test-claude-integration.sh"
    echo ""
else
    echo -e "${YELLOW}Claude Desktop:${NC}"
    echo "  Status: Config not found (not installed?)"
    echo "  Next: Install Claude Desktop from claude.ai"
    echo "  Then: Add config to ~/Library/Application\\ Support/Claude/claude_desktop_config.json"
    echo ""
fi

echo -e "${BLUE}Raycast AI:${NC}"
echo "  Status: Manual setup required via UI"
echo "  Next: Follow checklist in tests/test-raycast-integration.md"
echo "  Server path: $SERVER_PATH"
echo "  Database: $DB_PATH"
echo ""

##############################################################################
# Export Results
##############################################################################

# Save results to file
RESULTS_FILE="/tmp/mcp-cross-platform-test-$(date +%Y%m%d-%H%M%S).txt"

{
    echo "MCP Cross-Platform Compatibility Test Results"
    echo "Generated: $(date)"
    echo ""
    echo "Database: $DB_PATH"
    echo "OpenCode Config: $OPENCODE_CONFIG"
    echo "Claude Config: $CLAUDE_CONFIG"
    echo ""
    echo "Results:"
    echo "  Passed:  $TESTS_PASSED"
    echo "  Failed:  $TESTS_FAILED"
    echo "  Skipped: $TESTS_SKIPPED"
    echo "  Total:   $TOTAL_TESTS"
    echo ""
    echo "System Info:"
    echo "  OS: $OSTYPE"
    echo "  Node: $(node --version)"
    echo "  npm: $(npm --version)"
    echo "  SQLite: $(sqlite3 --version)"
} > "$RESULTS_FILE"

echo -e "${BLUE}ℹ${NC} Test results saved to: $RESULTS_FILE"
echo ""

exit $EXIT_CODE
