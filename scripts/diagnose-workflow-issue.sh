#!/usr/bin/env bash

set -euo pipefail

echo "=== OpenCode MCP Integration Diagnostic ==="
echo ""

echo "1. Checking Claude Desktop Configuration..."
config_file=~/Library/Application\ Support/Claude/claude_desktop_config.json
if [[ -f "$config_file" ]]; then
    echo "✅ Configuration file exists"
    cat "$config_file"
else
    echo "❌ Configuration file not found at: $config_file"
fi
echo ""

echo "2. Checking MCP Server Files..."
mcp_server=~/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory/dist/index.js
if [[ -f "$mcp_server" ]]; then
    echo "✅ MCP server dist file exists"
    ls -lh "$mcp_server"
else
    echo "❌ MCP server not found at: $mcp_server"
fi
echo ""

echo "3. Checking MCP Database..."
db_path=~/.opencode/sessions/session.db
if [[ -f "$db_path" ]]; then
    echo "✅ MCP database exists"
    ls -lh "$db_path"
    echo "Tables:"
    sqlite3 "$db_path" ".tables" | tr ' ' '\n' | sort
else
    echo "❌ MCP database not found at: $db_path"
fi
echo ""

echo "4. Testing MCP Server Startup..."
if node "$mcp_server" --version 2>&1 | head -5; then
    echo "✅ MCP server can start"
else
    echo "❌ MCP server failed to start"
fi
echo ""

echo "5. Testing mcp-direct-db.sh Functions..."
if source ~/.config/opencode/context/mcp-direct-db.sh 2>&1; then
    echo "✅ mcp-direct-db.sh loaded successfully"
    if mcp_db_available; then
        echo "✅ MCP database is available"
    else
        echo "❌ MCP database not available"
    fi
else
    echo "❌ Failed to load mcp-direct-db.sh"
fi
echo ""

echo "6. Checking Node.js Installation..."
which node
node --version
echo ""

echo "7. Testing MCP Database Operations..."
source ~/.config/opencode/context/mcp-direct-db.sh
if mcp_store_interaction "test-workflow-$(date +%s)" "user" "Diagnostic test" '{"test": true}'; then
    echo "✅ Can write to MCP database"
else
    echo "❌ Cannot write to MCP database"
fi
echo ""

echo "8. Checking workflow-orchestrator.md Configuration..."
workflow_file=~/.config/opencode/agent/workflow-orchestrator.md
if [[ -f "$workflow_file" ]]; then
    echo "✅ workflow-orchestrator.md exists"
    echo "MCP references:"
    grep -n "mcp-direct-db" "$workflow_file" | head -5
else
    echo "❌ workflow-orchestrator.md not found"
fi
echo ""

echo "9. Checking for Running MCP Processes..."
ps aux | grep -i "session-memory\|mcp" | grep -v grep || echo "No MCP processes running"
echo ""

echo "10. Testing Full MCP Integration..."
source ~/.config/opencode/context/mcp-direct-db.sh
if [[ -n "$HAS_MCP_SESSION_MEMORY" ]]; then
    echo "✅ HAS_MCP_SESSION_MEMORY is set to: $HAS_MCP_SESSION_MEMORY"
else
    echo "ℹ️  HAS_MCP_SESSION_MEMORY not set (this is normal - set by workflow)"
fi

if command -v mcp_db_available >/dev/null 2>&1 && mcp_db_available; then
    export HAS_MCP_SESSION_MEMORY=true
    echo "✅ MCP functions available and database accessible"
    
    export ROUTING_PATTERNS=$(mcp_get_routing_patterns "0.7")
    echo "✅ Can retrieve routing patterns"
    echo "Patterns: $ROUTING_PATTERNS" | head -c 200
else
    echo "❌ MCP functions or database not accessible"
fi
echo ""

echo "=== Diagnostic Complete ==="
echo ""
echo "SUMMARY:"
echo "- If all checks pass (✅), the MCP integration should work"
echo "- If Claude Desktop shows 'session closed', the issue is likely:"
echo "  1. Claude Desktop not restarted after config change"
echo "  2. Path in claude_desktop_config.json incorrect"
echo "  3. Node.js not in Claude Desktop's PATH"
echo ""
echo "NEXT STEPS:"
echo "1. Restart Claude Desktop completely (Quit and reopen)"
echo "2. Open Claude Desktop and check Developer Tools (Help -> Toggle Developer Tools)"
echo "3. Look for MCP server startup errors in Console tab"
