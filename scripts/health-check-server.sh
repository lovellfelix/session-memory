#!/bin/bash
# health-check-server.sh - MCP server health verification

set -euo pipefail

PROJECT_ROOT="/Users/lfelix/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory"
TEMP_LOG="/tmp/mcp-server-health-check-$$.log"

echo "🔍 MCP Server Health Check"
echo "==========================="
echo ""

# Check if project exists
if [ ! -d "$PROJECT_ROOT" ]; then
  echo "❌ FAIL: Project directory not found: $PROJECT_ROOT"
  exit 1
fi
echo "✅ Project directory exists"

# Check if built files exist
if [ ! -f "$PROJECT_ROOT/dist/index.js" ]; then
  echo "❌ FAIL: Server not built (dist/index.js missing)"
  echo "   Run: npm run build"
  exit 1
fi
echo "✅ Built files present"

# Check Node.js version
NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "18" ]; then
  echo "❌ FAIL: Node.js version too old (got: v$NODE_VERSION, required: v18+)"
  exit 1
fi
echo "✅ Node.js version OK: $(node --version)"

# Start server in background
echo "🚀 Starting server for health check..."
cd "$PROJECT_ROOT"
node dist/index.js > "$TEMP_LOG" 2>&1 &
SERVER_PID=$!

# Wait for startup
sleep 2

# Kill after 5 seconds if still running
(sleep 5 && kill $SERVER_PID 2>/dev/null || true) &
KILLER_PID=$!

# Wait for startup
sleep 2

# Check if process is still running
if ! ps -p $SERVER_PID > /dev/null 2>&1; then
  echo "❌ FAIL: Server crashed during startup"
  echo ""
  echo "Error log:"
  cat "$TEMP_LOG"
  rm "$TEMP_LOG"
  exit 1
fi
echo "✅ Server started successfully (PID: $SERVER_PID)"

# Check for startup errors in log
if grep -i "error" "$TEMP_LOG" | grep -v "No error"; then
  echo "⚠️  WARNING: Errors detected in startup log:"
  grep -i "error" "$TEMP_LOG"
else
  echo "✅ No startup errors detected"
fi

# Check for MCP tools initialization
if grep -q "tools available" "$TEMP_LOG" 2>/dev/null; then
  echo "✅ MCP tools initialized"
else
  echo "⚠️  WARNING: Could not confirm MCP tools initialization"
fi

# Cleanup
kill $SERVER_PID 2>/dev/null || true
kill $KILLER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
rm "$TEMP_LOG"

echo ""
echo "✅ All server health checks passed"
exit 0
