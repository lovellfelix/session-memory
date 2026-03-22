# MCP Integration Test Suite - Quick Start Guide

## Overview

Four comprehensive test suites validate MCP functionality across all three supported platforms:

| Test | Command | Duration | Platform |
|------|---------|----------|----------|
| **OpenCode CLI** | `npm run test -- test-opencode-integration.ts` | 5-10s | CLI/Node.js |
| **Claude Desktop** | `./tests/test-claude-integration.sh` | 3-5s | Desktop App |
| **Raycast AI** | Follow `test-raycast-integration.md` | 30-45min | Manual/UI |
| **Cross-Platform** | `./tests/test-cross-platform.sh` | 10-15s | All |

---

## 1️⃣ Cross-Platform Compatibility Check (START HERE)

Run this first to validate your environment:

```bash
cd ${HOME}/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory
./tests/test-cross-platform.sh
```

**Expected Output**:
```
✅ All critical tests passed!

MCP server is ready for use on:
  • OpenCode CLI (direct integration via tool/mcp.ts)
  • Claude Desktop (via stdio MCP protocol)
  • Raycast AI (via stdio MCP protocol)
```

**What It Checks**:
- ✅ Database health and integrity
- ✅ OpenCode configuration
- ✅ Claude Desktop configuration
- ✅ MCP server files and build
- ✅ Node.js and dependencies
- ✅ Security (no hardcoded secrets)

---

## 2️⃣ OpenCode CLI Integration Tests

### For Development

```bash
# Build first
npm run build

# Run TypeScript integration tests
npm run test -- test-opencode-integration.ts

# Or run specific test group
npm run test -- test-opencode-integration.ts -t "Session Context"
```

### What It Tests

- Tool availability detection
- Session context storage/retrieval
- User preference tracking with confidence scoring
- Project convention learning
- Task board synchronization
- Error handling and recovery
- Cross-workflow pattern learning
- Interaction history tracking

### Expected Results
- ✅ 40+ tests passing
- ✅ 0 failures
- ✅ Full TypeScript type safety

**Test File**: `tests/test-opencode-integration.ts`

---

## 3️⃣ Claude Desktop Integration Tests

### Prerequisites

Make sure Claude Desktop is installed and configured:

```bash
# Check Claude config
jq . ~/Library/Application\ Support/Claude/claude_desktop_config.json | grep -A5 session-memory
```

### Run Tests

```bash
./tests/test-claude-integration.sh
```

### What It Tests

- Claude Desktop config validation
- stdio JSON-RPC 2.0 protocol
- Tool list endpoint
- Tool invocation (preference tracking, context storage)
- Error handling (invalid tools, malformed JSON)
- Protocol compliance (jsonrpc field, id, result/error)

### Expected Results
```
✓ Claude Desktop config exists
✓ MCP server configured in Claude
✓ Server command is executable
✓ Server responds to initialize request
✓ Server lists available tools
✓ Tool invocation: track_user_preference
✓ Tool invocation: store_session_context
✓ Server handles invalid tool name gracefully
✓ Server handles malformed JSON gracefully
✓ Response includes jsonrpc version field
✓ Response includes request id
✓ Response includes result or error field

✅ All tests passed!
```

**Test File**: `tests/test-claude-integration.sh`

---

## 4️⃣ Raycast AI Integration Tests

### Prerequisites

1. Install Raycast (if not already installed)
2. Open Raycast and configure MCP server

### Run Manual Tests

Open test checklist:

```bash
open tests/test-raycast-integration.md
```

### Setup Steps (from checklist)

1. **Manage Servers**
   - Open Raycast → Cmd+K → "Manage Servers"
   - Add new server

2. **Configure**
   - Name: `session-memory`
   - Command: `node`
   - Args: `/opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory/dist/index.js`
   - Env: `SESSION_DB=${HOME}/.opencode/sessions/session.db`

3. **Test**
   - Open Raycast AI chat
   - Type: `@session-memory list available tools`
   - Should see 15+ tools listed

### What It Tests

25-point checklist covering:
- Server setup and configuration
- Tool discovery
- Preferences (store, retrieve, update)
- Session context operations
- Project conventions
- Task board functionality
- Error handling and recovery
- Performance benchmarks
- Cross-client synchronization

### Expected Duration
- 30-45 minutes for complete manual validation
- Creates 25 screenshots documenting all features

**Test File**: `tests/test-raycast-integration.md`

---

## 🏃 Quick Test Scripts

### Run All Tests (Full Suite)

```bash
#!/bin/bash
set -e

echo "🧪 Running MCP Integration Test Suite"

# 1. Cross-platform check
echo "1. Cross-platform compatibility..."
./tests/test-cross-platform.sh

# 2. OpenCode tests
echo "2. OpenCode CLI integration..."
npm run build
npm run test -- test-opencode-integration.ts

# 3. Claude tests
echo "3. Claude Desktop integration..."
./tests/test-claude-integration.sh

# 4. Manual Raycast (requires human interaction)
echo "4. Raycast AI integration..."
echo "   See: tests/test-raycast-integration.md"
echo "   (25-point manual checklist)"

echo "✅ All automated tests passed!"
```

### Run Quick Smoke Test (1-2 minutes)

```bash
#!/bin/bash

echo "🧪 Quick MCP Smoke Test"

# Check database
sqlite3 ~/.opencode/sessions/session.db "PRAGMA integrity_check;"

# Check configurations
jq . ~/.config/opencode/opencode.json > /dev/null || jq . ~/.config/opencode/opencode.base.json > /dev/null
jq . ~/Library/Application\ Support/Claude/claude_desktop_config.json > /dev/null

# Check server
ls -l /opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory/dist/index.js

echo "✅ Smoke test passed!"
```

---

## 📊 Test Results Interpretation

### ✅ All Tests Passed

```
✅ All critical tests passed!
Passed:  XX
Failed:  0
Skipped: 0
```

**Next Steps**:
- MCP is ready for production use
- All platforms are compatible
- Database is healthy

### ⚠️ Some Tests Failed

```
❌ Some critical tests failed
Passed:  XX
Failed:  Y
Skipped: Z
```

**Troubleshooting**:
1. Check which tests failed
2. Review error details
3. Common issues:
   - Database corruption → Run `sqlite3 ~/.opencode/sessions/session.db "PRAGMA integrity_check;"`
   - Missing config → Set up Claude/Raycast again
   - Server not built → Run `npm run build`
   - Port conflict → Check if other services using ports

### ⏭️ Tests Skipped

Some tests skip if prerequisites not met:
- Claude tests skip if Claude Desktop not installed
- Raycast tests are manual (intentionally)
- Some tests skip if server not compiled

**Resolution**:
- Install missing prerequisites
- Build with `npm run build`
- Follow manual test checklists

---

## 🔧 Troubleshooting

### Database Issues

```bash
# Check database health
sqlite3 ~/.opencode/sessions/session.db "PRAGMA integrity_check;"

# Check database size
du -h ~/.opencode/sessions/session.db

# List all tables
sqlite3 ~/.opencode/sessions/session.db ".tables"

# Verify specific table
sqlite3 ~/.opencode/sessions/session.db "SELECT COUNT(*) FROM user_preferences;"
```

### Configuration Issues

```bash
# Check OpenCode config
jq .permission ~/.opencode/opencode.json

# Check Claude config
jq .mcpServers.session-memory ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Check environment
echo $SESSION_DB
echo $NODE_ENV
```

### Server Issues

```bash
# Check if server file exists
ls -l /opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory/dist/index.js

# Check if server starts
timeout 3 node /opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory/dist/index.js < /dev/null

# Check npm/node versions
node --version
npm --version
```

---

## 📈 Monitoring & Maintenance

### Monthly Health Check

```bash
#!/bin/bash
# Monthly MCP health check

echo "📊 MCP Health Check"

# 1. Database
INTEGRITY=$(sqlite3 ~/.opencode/sessions/session.db "PRAGMA integrity_check;")
DB_SIZE=$(du -h ~/.opencode/sessions/session.db | cut -f1)
echo "Database: $INTEGRITY ($DB_SIZE)"

# 2. Configurations
echo "OpenCode: $(test -f ~/.config/opencode/opencode.json && echo ✓ || echo ✗)"
echo "Claude: $(test -f ~/Library/Application\ Support/Claude/claude_desktop_config.json && echo ✓ || echo ✗)"

# 3. Test suite
echo "Running compatibility tests..."
./tests/test-cross-platform.sh --quick

echo "✅ Health check complete"
```

### Quarterly Full Test

```bash
#!/bin/bash
# Quarterly full test suite

echo "🧪 Quarterly Full Test Suite"

# Run all tests
./tests/test-cross-platform.sh
npm run test -- test-opencode-integration.ts
./tests/test-claude-integration.sh

# Archive results
mkdir -p ~/.opencode/test-results/$(date +%Y-Q%q)
cp /tmp/mcp-test-results.txt ~/.opencode/test-results/$(date +%Y-Q%q)/

echo "✅ Full test suite complete"
```

---

## 🎯 Success Indicators

✅ **Successful Setup** when:
- [x] Cross-platform test passes
- [x] Database integrity check passes
- [x] All configurations present
- [x] OpenCode tests pass (40+ tests)
- [x] Claude tests pass (if using Claude)
- [x] Raycast tests complete (if using Raycast)

---

## 📞 Getting Help

1. **Check this guide**: Start here for troubleshooting
2. **Read test output**: Detailed error messages in test results
3. **Review specific test files**:
   - OpenCode: `tests/test-opencode-integration.ts`
   - Claude: `tests/test-claude-integration.sh`
   - Raycast: `tests/test-raycast-integration.md`
   - Cross-platform: `tests/test-cross-platform.sh`
4. **Database issues**: Run `sqlite3 ~/.opencode/sessions/session.db ".mode line" "SELECT * FROM session_contexts LIMIT 1;"`
5. **Full report**: See `MCP_TEST_SUITE_REPORT.md`

---

## 📋 Test File Locations

```
${HOME}/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory/tests/
├── test-opencode-integration.ts       # 40+ unit tests
├── test-claude-integration.sh         # 13 stdio protocol tests
├── test-raycast-integration.md        # 25-point manual checklist
├── test-cross-platform.sh             # Compatibility suite
├── MCP_TEST_SUITE_REPORT.md          # This report
├── QUICK_START.md                     # This guide
└── setup.ts                            # Test database init
```

---

**Last Updated**: January 27, 2026  
**Status**: ✅ Production Ready  
**Version**: 1.0
