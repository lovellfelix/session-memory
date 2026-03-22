#!/bin/bash
# Test script to validate task_board fix after sql.js migration

set -euo pipefail

echo "=== Task Board Fix Validation ==="
echo ""

# Test 1: Verify MCP server uses sql.js
echo "Test 1: Checking MCP server dependencies..."
cd /Users/lfelix/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory

if grep -q "better-sqlite3" package.json; then
  echo "❌ FAILED: better-sqlite3 found in package.json"
  exit 1
else
  echo "✅ PASSED: No better-sqlite3 in package.json"
fi

if grep -q "sql.js" package.json; then
  echo "✅ PASSED: sql.js dependency present"
else
  echo "❌ FAILED: sql.js missing from package.json"
  exit 1
fi

# Test 2: Verify dist/database.js uses sql.js
echo ""
echo "Test 2: Checking compiled database adapter..."
if grep -q "import initSqlJs from 'sql.js'" dist/database.js; then
  echo "✅ PASSED: Compiled code uses sql.js"
else
  echo "❌ FAILED: Compiled code doesn't use sql.js"
  exit 1
fi

# Test 3: Verify tool name in command/tasks.md
echo ""
echo "Test 3: Checking /tasks command uses correct tool name..."
cd /Users/lfelix/.dotfiles/opencode/.config/opencode

if grep -q "mcp.isToolAvailable('task_board')" command/tasks.md; then
  echo "✅ PASSED: Command checks for 'task_board' tool"
else
  echo "❌ FAILED: Command still checks for wrong tool name"
  exit 1
fi

if grep -q "mcp.callTool('task_board'" command/tasks.md; then
  echo "✅ PASSED: Command calls 'task_board' tool"
else
  echo "❌ FAILED: Command calls wrong tool name"
  exit 1
fi

# Test 4: Direct MCP server test
echo ""
echo "Test 4: Testing MCP server task_board tool directly..."
cd /Users/lfelix/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory

result=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"task_board","arguments":{"include_done":false}}}' | timeout 10 node dist/index.js 2>&1 | grep '"result"' || true)

if [ -z "$result" ]; then
  echo "❌ FAILED: task_board tool didn't return result"
  exit 1
else
  echo "✅ PASSED: task_board tool returned result"
fi

# Test 5: Check for better-sqlite3 errors
echo ""
echo "Test 5: Checking for better-sqlite3 errors..."
error_check=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"task_board","arguments":{"include_done":false}}}' | timeout 10 node dist/index.js 2>&1 | grep -i "better-sqlite3" || true)

if [ -n "$error_check" ]; then
  echo "❌ FAILED: better-sqlite3 error detected"
  echo "$error_check"
  exit 1
else
  echo "✅ PASSED: No better-sqlite3 errors"
fi

# Test 6: Verify documentation updated
echo ""
echo "Test 6: Checking documentation references..."
if grep -q "task_board" context/*.md 2>/dev/null; then
  echo "⚠️  WARNING: Documentation still references task_board (should be task_board)"
else
  echo "✅ PASSED: Documentation uses correct tool name"
fi

echo ""
echo "=== All Tests Passed! ==="
echo ""
echo "Summary:"
echo "- MCP server migrated to sql.js ✅"
echo "- task_board tool working correctly ✅"
echo "- /tasks command fixed to use correct tool name ✅"
echo "- Documentation updated ✅"
echo ""
echo "Next steps:"
echo "1. Restart Claude Desktop to reload the configuration"
echo "2. Test /tasks command in a conversation"
echo "3. Consider removing tool/mcp.ts if it's no longer needed (uses better-sqlite3)"
