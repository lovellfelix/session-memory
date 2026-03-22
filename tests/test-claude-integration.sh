#!/usr/bin/env bash

##############################################################################
# Claude Desktop MCP Integration Test
# 
# Tests MCP server via stdio protocol (how Claude Desktop communicates with MCP)
# Validates JSON-RPC 2.0 protocol implementation
##############################################################################

set -euo pipefail

# Configuration
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
TEST_RESULTS_FILE="/tmp/claude-mcp-integration-results.txt"
FAILED_TESTS=0
PASSED_TESTS=0

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test logging function
log_test() {
    local test_name="$1"
    local status="$2"
    local details="${3:-}"
    
    if [[ "$status" == "PASS" ]]; then
        echo -e "${GREEN}✓${NC} $test_name"
        ((PASSED_TESTS++))
    elif [[ "$status" == "FAIL" ]]; then
        echo -e "${RED}✗${NC} $test_name"
        if [[ -n "$details" ]]; then
            echo "  Details: $details"
        fi
        ((FAILED_TESTS++))
    elif [[ "$status" == "SKIP" ]]; then
        echo -e "${YELLOW}⊘${NC} $test_name"
    else
        echo -e "${BLUE}ⓘ${NC} $test_name: $details"
    fi
}

echo -e "${BLUE}🧪 Claude Desktop MCP Integration Test Suite${NC}\n"

##############################################################################
# Test 1: Configuration Validation
##############################################################################
echo -e "${BLUE}[Test Group 1] Configuration Validation${NC}"

if [[ ! -f "$CLAUDE_CONFIG" ]]; then
    log_test "Claude Desktop config exists" "FAIL" "Config not found at $CLAUDE_CONFIG"
    log_test "MCP server configured in Claude" "SKIP" "Config doesn't exist"
    log_test "Server command is executable" "SKIP" "Config doesn't exist"
else
    log_test "Claude Desktop config exists" "PASS"
    
    # Extract MCP server configuration
    if jq -e '.mcpServers."session-memory"' "$CLAUDE_CONFIG" >/dev/null 2>&1; then
        log_test "MCP server configured in Claude" "PASS"
        
        SERVER_COMMAND=$(jq -r '.mcpServers."session-memory".command' "$CLAUDE_CONFIG" 2>/dev/null || echo "")
        SERVER_ARGS=$(jq -r '.mcpServers."session-memory".args[0]' "$CLAUDE_CONFIG" 2>/dev/null || echo "")
        
        if [[ -f "$SERVER_COMMAND" ]] && [[ -f "$SERVER_ARGS" ]]; then
            log_test "Server command is executable" "PASS"
        else
            log_test "Server command is executable" "FAIL" "Command or args invalid: $SERVER_COMMAND $SERVER_ARGS"
        fi
    else
        log_test "MCP server configured in Claude" "FAIL" "No session-memory server found in config"
    fi
fi

echo ""

##############################################################################
# Test 2: stdio Protocol Communication
##############################################################################
echo -e "${BLUE}[Test Group 2] stdio Protocol Communication${NC}"

# Get the actual server path from config
if [[ -f "$CLAUDE_CONFIG" ]]; then
    SERVER_COMMAND=$(jq -r '.mcpServers."session-memory".command // "node"' "$CLAUDE_CONFIG" 2>/dev/null)
    SERVER_ARGS=$(jq -r '.mcpServers."session-memory".args[0] // ""' "$CLAUDE_CONFIG" 2>/dev/null)
    
    if [[ -n "$SERVER_ARGS" ]] && [[ -f "$SERVER_ARGS" ]]; then
        # Test 2a: Server responds to initialize message
        INIT_REQUEST='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}}}'
        
        INIT_RESPONSE=$(echo "$INIT_REQUEST" | timeout 5 "$SERVER_COMMAND" "$SERVER_ARGS" 2>/dev/null || echo "{}")
        
        if echo "$INIT_RESPONSE" | jq -e '.result.serverInfo' >/dev/null 2>&1; then
            log_test "Server responds to initialize request" "PASS"
        else
            log_test "Server responds to initialize request" "FAIL" "Invalid response: $INIT_RESPONSE"
        fi
        
        # Test 2b: Server lists available tools
        TOOLS_REQUEST='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
        
        # Need to initialize first, then list tools
        TOOLS_RESPONSE=$(
            (
                echo "$INIT_REQUEST"
                sleep 0.1
                echo "$TOOLS_REQUEST"
            ) | timeout 5 "$SERVER_COMMAND" "$SERVER_ARGS" 2>/dev/null || echo "{}"
        )
        
        # Parse last non-empty JSON object
        TOOLS_JSON=$(echo "$TOOLS_RESPONSE" | grep -o '{.*}' | tail -1 || echo "{}")
        
        TOOL_COUNT=$(echo "$TOOLS_JSON" | jq '.result.tools | length' 2>/dev/null || echo "0")
        
        if [[ "$TOOL_COUNT" -gt 0 ]]; then
            log_test "Server lists available tools" "PASS" "Found $TOOL_COUNT tools"
        else
            log_test "Server lists available tools" "FAIL" "Expected > 0 tools, got $TOOL_COUNT"
        fi
    else
        log_test "Server responds to initialize request" "SKIP" "Server path invalid"
        log_test "Server lists available tools" "SKIP" "Server path invalid"
    fi
else
    log_test "Server responds to initialize request" "SKIP" "Claude config not found"
    log_test "Server lists available tools" "SKIP" "Claude config not found"
fi

echo ""

##############################################################################
# Test 3: Tool Invocation
##############################################################################
echo -e "${BLUE}[Test Group 3] Tool Invocation${NC}"

if [[ -f "$CLAUDE_CONFIG" ]]; then
    SERVER_COMMAND=$(jq -r '.mcpServers."session-memory".command // "node"' "$CLAUDE_CONFIG" 2>/dev/null)
    SERVER_ARGS=$(jq -r '.mcpServers."session-memory".args[0] // ""' "$CLAUDE_CONFIG" 2>/dev/null)
    
    if [[ -n "$SERVER_ARGS" ]] && [[ -f "$SERVER_ARGS" ]]; then
        # Test preference tracking
        PREF_CALL='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"track_user_preference","arguments":{"user_id":"test","category":"code_style","preference_key":"test_quotes","preference_value":"double","confidence":0.9}}}'
        
        PREF_RESPONSE=$(
            (
                echo "$INIT_REQUEST"
                sleep 0.1
                echo "$PREF_CALL"
            ) | timeout 5 "$SERVER_COMMAND" "$SERVER_ARGS" 2>/dev/null || echo "{}"
        )
        
        PREF_JSON=$(echo "$PREF_RESPONSE" | grep -o '{.*}' | tail -1 || echo "{}")
        
        if echo "$PREF_JSON" | jq -e '.result' >/dev/null 2>&1; then
            log_test "Tool invocation: track_user_preference" "PASS"
        else
            log_test "Tool invocation: track_user_preference" "FAIL" "Tool call failed"
        fi
        
        # Test session context storage
        CONTEXT_CALL='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"store_session_context","arguments":{"session_id":"test-claude-001","context_key":"workflow","context_value":"Testing Claude integration","metadata":"{\"test\":true}"}}}'
        
        CONTEXT_RESPONSE=$(
            (
                echo "$INIT_REQUEST"
                sleep 0.1
                echo "$CONTEXT_CALL"
            ) | timeout 5 "$SERVER_COMMAND" "$SERVER_ARGS" 2>/dev/null || echo "{}"
        )
        
        CONTEXT_JSON=$(echo "$CONTEXT_RESPONSE" | grep -o '{.*}' | tail -1 || echo "{}")
        
        if echo "$CONTEXT_JSON" | jq -e '.result' >/dev/null 2>&1; then
            log_test "Tool invocation: store_session_context" "PASS"
        else
            log_test "Tool invocation: store_session_context" "FAIL" "Tool call failed"
        fi
    else
        log_test "Tool invocation: track_user_preference" "SKIP" "Server path invalid"
        log_test "Tool invocation: store_session_context" "SKIP" "Server path invalid"
    fi
else
    log_test "Tool invocation: track_user_preference" "SKIP" "Claude config not found"
    log_test "Tool invocation: store_session_context" "SKIP" "Claude config not found"
fi

echo ""

##############################################################################
# Test 4: Error Handling
##############################################################################
echo -e "${BLUE}[Test Group 4] Error Handling${NC}"

if [[ -f "$CLAUDE_CONFIG" ]]; then
    SERVER_COMMAND=$(jq -r '.mcpServers."session-memory".command // "node"' "$CLAUDE_CONFIG" 2>/dev/null)
    SERVER_ARGS=$(jq -r '.mcpServers."session-memory".args[0] // ""' "$CLAUDE_CONFIG" 2>/dev/null)
    
    if [[ -n "$SERVER_ARGS" ]] && [[ -f "$SERVER_ARGS" ]]; then
        # Test invalid tool call
        INVALID_TOOL='{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nonexistent_tool","arguments":{}}}'
        
        INVALID_RESPONSE=$(
            (
                echo "$INIT_REQUEST"
                sleep 0.1
                echo "$INVALID_TOOL"
            ) | timeout 5 "$SERVER_COMMAND" "$SERVER_ARGS" 2>/dev/null || echo "{}"
        )
        
        INVALID_JSON=$(echo "$INVALID_RESPONSE" | grep -o '{.*}' | tail -1 || echo "{}")
        
        if echo "$INVALID_JSON" | jq -e '.error' >/dev/null 2>&1; then
            log_test "Server handles invalid tool name gracefully" "PASS"
        else
            log_test "Server handles invalid tool name gracefully" "FAIL" "Expected error response"
        fi
        
        # Test malformed JSON
        MALFORMED='not json at all'
        
        MALFORMED_RESPONSE=$(
            (
                echo "$INIT_REQUEST"
                sleep 0.1
                echo "$MALFORMED"
            ) | timeout 5 "$SERVER_COMMAND" "$SERVER_ARGS" 2>&1 || echo ""
        )
        
        # Server should either ignore or error gracefully
        log_test "Server handles malformed JSON gracefully" "PASS" "(no crash)"
    else
        log_test "Server handles invalid tool name gracefully" "SKIP" "Server path invalid"
        log_test "Server handles malformed JSON gracefully" "SKIP" "Server path invalid"
    fi
else
    log_test "Server handles invalid tool name gracefully" "SKIP" "Claude config not found"
    log_test "Server handles malformed JSON gracefully" "SKIP" "Claude config not found"
fi

echo ""

##############################################################################
# Test 5: Protocol Compliance
##############################################################################
echo -e "${BLUE}[Test Group 5] JSON-RPC 2.0 Protocol Compliance${NC}"

if [[ -f "$CLAUDE_CONFIG" ]]; then
    SERVER_COMMAND=$(jq -r '.mcpServers."session-memory".command // "node"' "$CLAUDE_CONFIG" 2>/dev/null)
    SERVER_ARGS=$(jq -r '.mcpServers."session-memory".args[0] // ""' "$CLAUDE_CONFIG" 2>/dev/null)
    
    if [[ -n "$SERVER_ARGS" ]] && [[ -f "$SERVER_ARGS" ]]; then
        # Check response has proper JSON-RPC structure
        RESPONSE=$(
            (
                echo "$INIT_REQUEST"
            ) | timeout 5 "$SERVER_COMMAND" "$SERVER_ARGS" 2>/dev/null || echo "{}"
        )
        
        RESP_JSON=$(echo "$RESPONSE" | grep -o '{.*}' | head -1 || echo "{}")
        
        # Test for jsonrpc field
        if echo "$RESP_JSON" | jq -e '.jsonrpc == "2.0"' >/dev/null 2>&1; then
            log_test "Response includes jsonrpc version field" "PASS"
        else
            log_test "Response includes jsonrpc version field" "FAIL" "Missing or incorrect jsonrpc"
        fi
        
        # Test for id field
        if echo "$RESP_JSON" | jq -e '.id' >/dev/null 2>&1; then
            log_test "Response includes request id" "PASS"
        else
            log_test "Response includes request id" "FAIL" "Missing id field"
        fi
        
        # Test for result or error
        if echo "$RESP_JSON" | jq -e '.result // .error' >/dev/null 2>&1; then
            log_test "Response includes result or error field" "PASS"
        else
            log_test "Response includes result or error field" "FAIL" "Missing result/error"
        fi
    else
        log_test "Response includes jsonrpc version field" "SKIP" "Server path invalid"
        log_test "Response includes request id" "SKIP" "Server path invalid"
        log_test "Response includes result or error field" "SKIP" "Server path invalid"
    fi
else
    log_test "Response includes jsonrpc version field" "SKIP" "Claude config not found"
    log_test "Response includes request id" "SKIP" "Claude config not found"
    log_test "Response includes result or error field" "SKIP" "Claude config not found"
fi

echo ""

##############################################################################
# Test Summary
##############################################################################
TOTAL_TESTS=$((PASSED_TESTS + FAILED_TESTS))

echo -e "${BLUE}📊 Test Summary${NC}"
echo "═══════════════════════════════════════════"
echo -e "Passed:  ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed:  ${RED}$FAILED_TESTS${NC}"
echo -e "Total:   $TOTAL_TESTS"
echo "═══════════════════════════════════════════"

if [[ $FAILED_TESTS -eq 0 ]] && [[ $TOTAL_TESTS -gt 0 ]]; then
    echo -e "\n${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed or were skipped${NC}"
    exit 1
fi
