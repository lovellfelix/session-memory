#!/usr/bin/env bash
# Quick Bun compatibility test

set -e

echo "=== Bun Compatibility Verification ==="
echo ""

DIST_DIR="/Users/lfelix/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory/dist"

# Test 1: Check for isBun detection
echo "[1/6] Checking Bun runtime detection..."
if grep -q "const isBun = typeof globalThis.Bun !== 'undefined'" "$DIST_DIR/database.js"; then
    echo "  ✓ Runtime detection code found"
else
    echo "  ✗ Runtime detection code MISSING"
    exit 1
fi

# Test 2: Check for bun:sqlite import
echo "[2/6] Checking Bun SQLite import..."
if grep -q "await import('bun:sqlite')" "$DIST_DIR/database.js"; then
    echo "  ✓ Dynamic Bun SQLite import found"
else
    echo "  ✗ Bun SQLite import MISSING"
    exit 1
fi

# Test 3: Check for better-sqlite3 fallback
echo "[3/6] Checking Node.js better-sqlite3 fallback..."
if grep -q "better-sqlite3" "$DIST_DIR/database.js"; then
    echo "  ✓ Node.js fallback found"
else
    echo "  ✗ Node.js fallback MISSING"
    exit 1
fi

# Test 4: Check for async initialization
echo "[4/6] Checking async database initialization..."
if grep -q "this.db.initialize().then" "$DIST_DIR/index.js"; then
    echo "  ✓ Async initialization pattern found"
else
    echo "  ✗ Async initialization MISSING"
    exit 1
fi

# Test 5: Check for runtime logging
echo "[5/6] Checking runtime detection logging..."
if grep -q "runtime: isBun ? 'Bun' : 'Node.js'" "$DIST_DIR/database.js"; then
    echo "  ✓ Runtime logging found"
else
    echo "  ✗ Runtime logging MISSING"
    exit 1
fi

# Test 6: Check global installation
echo "[6/6] Checking global npm installation..."
GLOBAL_PATH="/opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory"
if [[ -L "$GLOBAL_PATH" ]]; then
    echo "  ✓ Global install is symlinked (auto-updated)"
elif [[ -d "$GLOBAL_PATH" ]]; then
    echo "  ⚠ Global install is physical copy (needs manual update)"
else
    echo "  ⚠ Global install not found"
fi

echo ""
echo "=== Verification Summary ==="
echo "✓ All critical checks passed!"
echo ""
echo "Build timestamps:"
stat -f "  database.js: %Sm" -t "%Y-%m-%d %H:%M:%S" "$DIST_DIR/database.js"
stat -f "  index.js:    %Sm" -t "%Y-%m-%d %H:%M:%S" "$DIST_DIR/index.js"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Desktop to load updated MCP server"
echo "  2. Check Claude Desktop logs for: 'runtime: Bun' or 'runtime: Node.js'"
echo "  3. Test with a workflow that uses session-memory MCP tools"
echo ""
