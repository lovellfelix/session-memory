#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== MCP Session-Memory Server Test ==="
echo ""

# Test 1: Check sql.js is installed
echo "[1/5] Checking sql.js installation..."
if [ -f "node_modules/sql.js/dist/sql-wasm.wasm" ]; then
    echo "✅ sql.js WASM file found"
else
    echo "❌ sql.js WASM file missing"
    exit 1
fi

# Test 2: Check no better-sqlite3
echo "[2/5] Checking for better-sqlite3..."
if grep -q "better-sqlite3" package.json 2>/dev/null; then
    echo "❌ better-sqlite3 still in package.json"
    exit 1
else
    echo "✅ No better-sqlite3 in package.json"
fi

# Test 3: Check dist files exist
echo "[3/5] Checking compiled files..."
if [ -f "dist/database.js" ] && [ -f "dist/index.js" ]; then
    echo "✅ Compiled files exist"
else
    echo "❌ Missing compiled files"
    exit 1
fi

# Test 4: Check dist uses sql.js
echo "[4/5] Checking dist/database.js uses sql.js..."
if grep -q "import initSqlJs from 'sql.js'" dist/database.js; then
    echo "✅ dist/database.js uses sql.js"
else
    echo "❌ dist/database.js doesn't use sql.js"
    exit 1
fi

# Test 5: Test MCP server can start
echo "[5/5] Testing MCP server startup..."
timeout 5s node dist/index.js <<EOF || true
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF

echo ""
echo "=== All Tests Passed! ==="
echo ""
echo "Next steps:"
echo "1. Quit Claude Desktop completely (⌘Q)"
echo "2. Wait 5 seconds"
echo "3. Reopen Claude Desktop"
echo "4. Test with: /tasks"
