#!/bin/bash
# Test MCP server directly
cd "$(dirname "$0")"

echo "Testing MCP server with task_board..."
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"task_board","arguments":{"include_done":false}}}' | timeout 5 node dist/index.js 2>&1

exit_code=$?
echo ""
echo "Exit code: $exit_code"

if [ $exit_code -eq 124 ]; then
  echo "ERROR: Command timed out after 5 seconds"
elif [ $exit_code -eq 0 ]; then
  echo "SUCCESS: Command completed"
else
  echo "ERROR: Command failed with exit code $exit_code"
fi
