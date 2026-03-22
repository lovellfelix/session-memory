#!/usr/bin/env bash
#
# Verify Bun Compatibility Fix in MCP Session-Memory Server
#
# This script validates that the compiled MCP server includes Bun runtime
# detection and compatibility code after the rebuild.
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     MCP Session-Memory Bun Compatibility Verification     ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Helper functions
pass() {
    echo -e "  ${GREEN}✓${NC} $1"
    ((PASSED++))
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    ((FAILED++))
}

warn() {
    echo -e "  ${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

info() {
    echo -e "${BLUE}▶${NC} $1"
}

# Check 1: Verify dist directory exists
echo ""
info "Checking build output directory..."
if [[ -d "$DIST_DIR" ]]; then
    pass "dist/ directory exists"
else
    fail "dist/ directory not found - run 'npm run build' first"
    exit 1
fi

# Check 2: Verify database.js exists
echo ""
info "Checking compiled database.js..."
if [[ -f "$DIST_DIR/database.js" ]]; then
    pass "database.js compiled successfully"
else
    fail "database.js not found"
    exit 1
fi

# Check 3: Verify index.js exists
echo ""
info "Checking compiled index.js..."
if [[ -f "$DIST_DIR/index.js" ]]; then
    pass "index.js compiled successfully"
else
    fail "index.js not found"
    exit 1
fi

# Check 4: Verify Bun runtime detection
echo ""
info "Verifying Bun runtime detection code..."
if grep -q "typeof globalThis.Bun !== 'undefined'" "$DIST_DIR/database.js"; then
    pass "Runtime detection: globalThis.Bun check found"
else
    fail "Runtime detection: globalThis.Bun check NOT found"
fi

if grep -q "const isBun = " "$DIST_DIR/database.js"; then
    pass "Runtime variable: isBun constant found"
else
    fail "Runtime variable: isBun constant NOT found"
fi

# Check 5: Verify Bun SQLite import
echo ""
info "Verifying Bun SQLite import code..."
if grep -q "bun:sqlite" "$DIST_DIR/database.js"; then
    pass "Bun SQLite: 'bun:sqlite' import found"
else
    fail "Bun SQLite: 'bun:sqlite' import NOT found"
fi

if grep -q "await import('bun:sqlite')" "$DIST_DIR/database.js"; then
    pass "Dynamic import: await import('bun:sqlite') found"
else
    fail "Dynamic import: await import('bun:sqlite') NOT found"
fi

if grep -q "Database: BunDatabase" "$DIST_DIR/database.js"; then
    pass "Bun adapter: BunDatabase destructuring found"
else
    fail "Bun adapter: BunDatabase destructuring NOT found"
fi

# Check 6: Verify Node.js better-sqlite3 fallback
echo ""
info "Verifying Node.js better-sqlite3 fallback..."
if grep -q "better-sqlite3" "$DIST_DIR/database.js"; then
    pass "Node.js fallback: better-sqlite3 import found"
else
    fail "Node.js fallback: better-sqlite3 import NOT found"
fi

# Check 7: Verify unified adapter pattern
echo ""
info "Verifying unified adapter implementation..."
if grep -q "this.adapter = " "$DIST_DIR/database.js"; then
    pass "Unified adapter: this.adapter assignment found"
else
    fail "Unified adapter: this.adapter assignment NOT found"
fi

# Check 8: Verify async initialization
echo ""
info "Verifying async database initialization..."
if grep -q "this.db.initialize().then" "$DIST_DIR/index.js"; then
    pass "Async init: initialize().then() pattern found"
else
    fail "Async init: initialize().then() pattern NOT found"
fi

if grep -q "this.initialized = true" "$DIST_DIR/index.js"; then
    pass "Initialization flag: this.initialized found"
else
    fail "Initialization flag: this.initialized NOT found"
fi

# Check 9: Verify runtime logging
echo ""
info "Verifying runtime detection logging..."
if grep -q "runtime: isBun ? 'Bun' : 'Node.js'" "$DIST_DIR/database.js"; then
    pass "Runtime logging: conditional log message found"
else
    fail "Runtime logging: conditional log message NOT found"
fi

# Check 10: Verify global installation (if symlinked)
echo ""
info "Checking global npm installation..."
GLOBAL_PATH="/opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory"
if [[ -L "$GLOBAL_PATH" ]]; then
    LINK_TARGET="$(readlink "$GLOBAL_PATH")"
    if [[ "$LINK_TARGET" == *"session-memory"* ]]; then
        pass "Global install: Symlinked to local development copy"
        info "   Link: $GLOBAL_PATH -> $LINK_TARGET"
    else
        warn "Global install: Symlinked but target looks unexpected"
        info "   Link: $GLOBAL_PATH -> $LINK_TARGET"
    fi
elif [[ -d "$GLOBAL_PATH" ]]; then
    warn "Global install: Physical copy (not symlinked)"
    info "   May need manual update: npm install -g or npm link"
else
    warn "Global install: Not found at $GLOBAL_PATH"
    info "   Install with: cd $PROJECT_DIR && npm link"
fi

# Check 11: Check dist file timestamps
echo ""
info "Checking build timestamps..."
DB_JS_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$DIST_DIR/database.js" 2>/dev/null || echo "unknown")
INDEX_JS_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$DIST_DIR/index.js" 2>/dev/null || echo "unknown")
info "   database.js: $DB_JS_TIME"
info "   index.js:    $INDEX_JS_TIME"

# Check 12: Verify source files have Bun compatibility
echo ""
info "Verifying source code has Bun compatibility..."
if [[ -f "$PROJECT_DIR/src/database.ts" ]]; then
    if grep -q "bun:sqlite" "$PROJECT_DIR/src/database.ts"; then
        pass "Source code: Bun SQLite import in database.ts"
    else
        fail "Source code: Bun SQLite import NOT in database.ts"
    fi
else
    warn "Source code: database.ts not found"
fi

# Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    VERIFICATION SUMMARY                    ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}✓ All critical checks passed!${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Restart Claude Desktop to load updated MCP server"
    echo "  2. Test with: /workflow 'Test MCP session-memory with Bun'"
    echo "  3. Check Claude Desktop logs for runtime detection message"
    echo ""
    exit 0
else
    echo -e "${RED}✗ $FAILED critical check(s) failed!${NC}"
    echo ""
    echo -e "${YELLOW}Troubleshooting:${NC}"
    echo "  1. Run 'npm run build' to recompile TypeScript"
    echo "  2. Check for compilation errors"
    echo "  3. Verify src/database.ts has Bun compatibility code"
    echo "  4. If global install is not symlinked, run 'npm link'"
    echo ""
    exit 1
fi
