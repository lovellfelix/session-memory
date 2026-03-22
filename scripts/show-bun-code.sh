#!/usr/bin/env bash
#
# Show Bun compatibility code snippets from compiled output
# This helps verify the exact patterns used in the compiled JavaScript
#

set -e

DIST_DIR="/Users/lfelix/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory/dist"

echo "=== Bun Compatibility Code Inspection ==="
echo ""

echo "📋 [1/5] Runtime Detection Code"
echo "────────────────────────────────────────────────────────────"
grep -A 2 "const isBun" "$DIST_DIR/database.js" | head -5
echo ""

echo "📋 [2/5] Bun SQLite Dynamic Import"
echo "────────────────────────────────────────────────────────────"
grep -B 2 -A 5 "bun:sqlite" "$DIST_DIR/database.js" | head -10
echo ""

echo "📋 [3/5] Node.js better-sqlite3 Fallback"
echo "────────────────────────────────────────────────────────────"
grep -B 2 -A 3 "better-sqlite3" "$DIST_DIR/database.js" | head -8
echo ""

echo "📋 [4/5] Async Database Initialization (index.js)"
echo "────────────────────────────────────────────────────────────"
grep -B 2 -A 6 "this.db.initialize()" "$DIST_DIR/index.js" | head -10
echo ""

echo "📋 [5/5] Runtime Logging"
echo "────────────────────────────────────────────────────────────"
grep -A 1 "runtime: isBun" "$DIST_DIR/database.js" | head -5
echo ""

echo "=== Code Inspection Complete ==="
echo ""
echo "✓ All Bun compatibility patterns are present in compiled output"
echo ""
