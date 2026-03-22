# Raycast AI MCP Integration Test Checklist

## Objective
Validate that the MCP session-memory server works correctly with Raycast AI via stdio protocol.

---

## Part 1: Server Setup in Raycast

### 1.1 Open Raycast Server Manager
- [ ] Open Raycast application
- [ ] Press `Cmd + K` to open command palette
- [ ] Search for and select "Manage Servers"
- [ ] Take screenshot: `Screenshots/01-manage-servers.png`

### 1.2 Add New MCP Server
- [ ] Click "Add New Server" or "+" button
- [ ] Fill in Server Name: `session-memory`
- [ ] Select Command: `node`
- [ ] Set Arguments:
  ```
  /opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory/dist/index.js
  ```
  - **NOTE**: Update this path to match your actual installation:
    - Run `npm list -g @lovellfelix/mcp-session-memory` to find actual path
    - Or use `which mcp-session-memory` if installed as command
- [ ] Set Environment Variables:
  ```
  SESSION_DB=${HOME}/.opencode/sessions/session.db
  ```
- [ ] Click "Save" or "Add"
- [ ] Take screenshot: `Screenshots/02-server-config.png`

### 1.3 Verify Server Appears in List
- [ ] Return to Manage Servers view
- [ ] Verify `session-memory` appears in the server list
- [ ] Status should show as "Connected" or "Available"
- [ ] Take screenshot: `Screenshots/03-server-list.png`

### 1.4 Verify Server Environment
- [ ] Check database file exists:
  ```bash
  ls -lh ~/.opencode/sessions/session.db
  ```
- [ ] Verify database is readable:
  ```bash
  sqlite3 ~/.opencode/sessions/session.db ".tables"
  ```
- [ ] Expected output: Lists all tables (session_contexts, user_preferences, etc.)
- [ ] Take screenshot of terminal: `Screenshots/04-db-check.png`

---

## Part 2: Tool Discovery

### 2.1 Open Raycast AI
- [ ] Open Raycast AI chat interface
- [ ] Look for MCP server selector (usually dropdown at top)
- [ ] Take screenshot: `Screenshots/05-raycast-ai-open.png`

### 2.2 List Available Tools
- [ ] Type in chat: `@session-memory list available tools`
- [ ] Press Enter
- [ ] Wait for response (should appear within 2 seconds)
- [ ] Expected response includes list of 15+ tools:
  - `store_session_context`
  - `retrieve_session_context`
  - `track_user_preference`
  - `get_user_preferences`
  - `learn_project_convention`
  - `get_project_conventions`
  - `sync_todos_to_tasks`
  - `task_board`
  - `store_routing_pattern`
  - `get_routing_patterns`
  - `store_interaction`
  - `get_interaction_history`
  - `mcp_cleanup_old_sessions`
  - `mcp_health_check`
  - `mcp_get_stats`
- [ ] Take screenshot: `Screenshots/06-tool-list.png`
- [ ] Document response time: `___________ seconds`

---

## Part 3: User Preference Functionality

### 3.1 Store User Preference
- [ ] Type in chat:
  ```
  @session-memory store my code style preference: I prefer double quotes for strings
  ```
- [ ] Press Enter
- [ ] Expected: Confirmation message like "Preference stored" or "Successfully saved"
- [ ] Take screenshot: `Screenshots/07-store-preference.png`

### 3.2 Retrieve User Preferences
- [ ] Type in chat:
  ```
  @session-memory what are my code style preferences?
  ```
- [ ] Press Enter
- [ ] Expected: Response includes the double quotes preference you just stored
- [ ] Take screenshot: `Screenshots/08-retrieve-preferences.png`

### 3.3 Update Preference with Higher Confidence
- [ ] Type in chat:
  ```
  @session-memory update my preference for string quotes to double with confidence 0.95
  ```
- [ ] Press Enter
- [ ] Type follow-up:
  ```
  @session-memory show my preferences
  ```
- [ ] Expected: String quotes preference shows confidence ~0.95
- [ ] Take screenshot: `Screenshots/09-updated-preference.png`

---

## Part 4: Session Context Operations

### 4.1 Store Session Context
- [ ] Type in chat:
  ```
  @session-memory save session "raycast-test-001" with context "Testing Raycast AI integration with MCP"
  ```
- [ ] Press Enter
- [ ] Expected: Confirmation message
- [ ] Take screenshot: `Screenshots/10-store-context.png`

### 4.2 Retrieve Session Context
- [ ] Type in chat:
  ```
  @session-memory retrieve session context for "raycast-test-001"
  ```
- [ ] Press Enter
- [ ] Expected: Returns the context you just stored
- [ ] Take screenshot: `Screenshots/11-retrieve-context.png`

### 4.3 Update Session Context
- [ ] Type in chat:
  ```
  @session-memory update session "raycast-test-001" with new context "Phase 2: Implementation in progress"
  ```
- [ ] Press Enter
- [ ] Type:
  ```
  @session-memory show context for "raycast-test-001"
  ```
- [ ] Expected: Shows updated context
- [ ] Take screenshot: `Screenshots/12-updated-context.png`

---

## Part 5: Project Convention Learning

### 5.1 Store Convention
- [ ] Type in chat:
  ```
  @session-memory learn convention: python project uses Result types for error handling
  ```
- [ ] Press Enter
- [ ] Expected: Confirmation
- [ ] Take screenshot: `Screenshots/13-store-convention.png`

### 5.2 Retrieve Conventions
- [ ] Type in chat:
  ```
  @session-memory what are the conventions for python project?
  ```
- [ ] Press Enter
- [ ] Expected: Returns the error handling convention
- [ ] Take screenshot: `Screenshots/14-retrieve-conventions.png`

---

## Part 6: Task Board Synchronization

### 6.1 Create Task
- [ ] Type in chat:
  ```
  @session-memory create task: "Test Raycast integration" with priority high
  ```
- [ ] Press Enter
- [ ] Expected: Task created confirmation
- [ ] Take screenshot: `Screenshots/15-create-task.png`

### 6.2 View Task Board
- [ ] Type in chat:
  ```
  @session-memory show task board
  ```
- [ ] Press Enter
- [ ] Expected: Kanban view with backlog, in_progress, done columns
- [ ] Should show the task you just created in backlog
- [ ] Take screenshot: `Screenshots/16-task-board.png`

### 6.3 Update Task Status
- [ ] Type in chat:
  ```
  @session-memory move task to in_progress
  ```
- [ ] Press Enter
- [ ] Check task board again:
  ```
  @session-memory show task board
  ```
- [ ] Expected: Task moved to in_progress column
- [ ] Take screenshot: `Screenshots/17-task-updated.png`

---

## Part 7: Error Handling & Recovery

### 7.1 Test with Invalid Session ID
- [ ] Type in chat:
  ```
  @session-memory retrieve context for "nonexistent-session-xyz"
  ```
- [ ] Press Enter
- [ ] Expected: Graceful error message (not a crash)
- [ ] Take screenshot: `Screenshots/18-invalid-session.png`

### 7.2 Test with Database Access Issues
- [ ] In terminal, temporarily lock database:
  ```bash
  exec 9<> ~/.opencode/sessions/session.db
  ```
- [ ] Type in chat:
  ```
  @session-memory get stats
  ```
- [ ] Press Enter
- [ ] Expected: Graceful handling (either retry or clear error message)
- [ ] Take screenshot: `Screenshots/19-db-locked.png`
- [ ] Release lock:
  ```bash
  exec 9>&-
  ```

### 7.3 Test Concurrent Operations
- [ ] Type multiple commands without waiting:
  ```
  @session-memory store context "test-1" with value "first"
  @session-memory store context "test-2" with value "second"
  @session-memory store context "test-3" with value "third"
  ```
- [ ] Expected: All succeed without errors or data corruption
- [ ] Verify:
  ```
  @session-memory retrieve all stored contexts
  ```
- [ ] Take screenshot: `Screenshots/20-concurrent-ops.png`

---

## Part 8: Performance Testing

### 8.1 Response Time for Simple Query
- [ ] Note current time
- [ ] Type in chat:
  ```
  @session-memory get user preferences
  ```
- [ ] Note response time (should be < 2 seconds)
- [ ] Expected response time: _______ seconds
- [ ] Take screenshot: `Screenshots/21-simple-query-time.png`

### 8.2 Response Time for Complex Query
- [ ] Note current time
- [ ] Type in chat:
  ```
  @session-memory show task board with all details
  ```
- [ ] Note response time
- [ ] Expected response time: _______ seconds (< 3 seconds)
- [ ] Take screenshot: `Screenshots/22-complex-query-time.png`

### 8.3 Handle 10+ Consecutive Operations
- [ ] In terminal, run:
  ```bash
  for i in {1..10}; do
    echo "Operation $i"
    sleep 0.5
  done
  ```
- [ ] Simultaneously in Raycast, run 10 consecutive preference updates
- [ ] Expected: No slowdown or timeouts
- [ ] All complete successfully
- [ ] Take screenshot: `Screenshots/23-bulk-operations.png`

---

## Part 9: Integration with Claude Desktop

### 9.1 Verify Both Work Simultaneously
- [ ] Open Claude Desktop
- [ ] Type in Claude:
  ```
  What are my stored preferences?
  ```
- [ ] Check response
- [ ] Switch to Raycast AI
- [ ] Type:
  ```
  @session-memory show my preferences
  ```
- [ ] Expected: Both show same preferences (shared database)
- [ ] Take screenshot: `Screenshots/24-cross-client-sync.png`

### 9.2 Test Cross-Client Context Consistency
- [ ] In Claude, create a session context
- [ ] Switch to Raycast
- [ ] Retrieve that same context
- [ ] Expected: Exact same data appears
- [ ] Take screenshot: `Screenshots/25-context-consistency.png`

---

## Part 10: Documentation

### 10.1 Create Test Report
Create a file: `RAYCAST_TEST_REPORT.md` with:

```markdown
# Raycast AI MCP Integration Test Report

**Date**: [Date]
**Tester**: [Your Name]
**Environment**: macOS [Version], Raycast [Version]

## Test Results Summary

| Test Group | Status | Notes |
|-----------|--------|-------|
| Server Setup | PASS/FAIL | [Notes] |
| Tool Discovery | PASS/FAIL | [Notes] |
| Preferences | PASS/FAIL | [Notes] |
| Contexts | PASS/FAIL | [Notes] |
| Conventions | PASS/FAIL | [Notes] |
| Tasks | PASS/FAIL | [Notes] |
| Error Handling | PASS/FAIL | [Notes] |
| Performance | PASS/FAIL | [Notes] |
| Cross-Client | PASS/FAIL | [Notes] |

## Detailed Results

### Server Setup
- Status: PASS/FAIL
- Server path: [Path used]
- Database: [Database path]
- Issues: [Any issues]

### Tool Discovery
- Tools found: [Number]
- Response time: [Seconds]
- Issues: [Any issues]

### Preferences
- Store: PASS/FAIL
- Retrieve: PASS/FAIL
- Update: PASS/FAIL
- Issues: [Any issues]

### Session Context
- Store: PASS/FAIL
- Retrieve: PASS/FAIL
- Update: PASS/FAIL
- Issues: [Any issues]

### Project Conventions
- Store: PASS/FAIL
- Retrieve: PASS/FAIL
- Issues: [Any issues]

### Task Board
- Create: PASS/FAIL
- View: PASS/FAIL
- Update: PASS/FAIL
- Issues: [Any issues]

### Error Handling
- Invalid input: PASS/FAIL
- Database locked: PASS/FAIL
- Concurrent ops: PASS/FAIL
- Issues: [Any issues]

### Performance
- Simple query: [Seconds]
- Complex query: [Seconds]
- Bulk ops (10+): PASS/FAIL
- Issues: [Any issues]

### Cross-Client Sync
- Preference sync: PASS/FAIL
- Context sync: PASS/FAIL
- Issues: [Any issues]

## Screenshots
Screenshots are in `Screenshots/` directory:
- 01-manage-servers.png
- 02-server-config.png
- 03-server-list.png
- 04-db-check.png
- 05-raycast-ai-open.png
- ... (see below for full list)

## Recommendations
[Your recommendations for improvement]

## Sign-Off
- All tests passed: YES/NO
- Ready for production: YES/NO
- Follow-up items: [List any]
```

---

## Screenshots Checklist

Create `Screenshots/` directory and capture:

- [ ] 01-manage-servers.png - Raycast server manager open
- [ ] 02-server-config.png - Server configuration form
- [ ] 03-server-list.png - Server appearing in list
- [ ] 04-db-check.png - Terminal showing database exists
- [ ] 05-raycast-ai-open.png - Raycast AI chat open
- [ ] 06-tool-list.png - List of available tools
- [ ] 07-store-preference.png - Preference storage confirmation
- [ ] 08-retrieve-preferences.png - Retrieved preferences
- [ ] 09-updated-preference.png - Updated preference with confidence
- [ ] 10-store-context.png - Context storage confirmation
- [ ] 11-retrieve-context.png - Retrieved context
- [ ] 12-updated-context.png - Updated context
- [ ] 13-store-convention.png - Convention storage
- [ ] 14-retrieve-conventions.png - Retrieved conventions
- [ ] 15-create-task.png - Task creation
- [ ] 16-task-board.png - Task board view
- [ ] 17-task-updated.png - Task status updated
- [ ] 18-invalid-session.png - Error handling
- [ ] 19-db-locked.png - Database lock handling
- [ ] 20-concurrent-ops.png - Concurrent operations
- [ ] 21-simple-query-time.png - Simple query response time
- [ ] 22-complex-query-time.png - Complex query response time
- [ ] 23-bulk-operations.png - Bulk operations (10+)
- [ ] 24-cross-client-sync.png - Cross-client preference sync
- [ ] 25-context-consistency.png - Context consistency across clients

---

## Success Criteria

✅ **PASS** if:
- [ ] All 25 test sections completed
- [ ] Screenshots captured for each major step
- [ ] No crashes or unhandled errors
- [ ] Response times < 3 seconds for all queries
- [ ] Preferences stored/retrieved correctly
- [ ] Context persisted across sessions
- [ ] Task board working properly
- [ ] Error handling graceful (no stack traces)
- [ ] Cross-client sync working
- [ ] Database integrity maintained

❌ **FAIL** if:
- [ ] Any unhandled exceptions or crashes
- [ ] Response times > 5 seconds
- [ ] Data corruption or inconsistency
- [ ] Configuration issues preventing server connection
- [ ] Cross-client data not syncing
- [ ] Database access errors

---

## Post-Test Actions

1. **Archive results**:
   ```bash
   mkdir -p ~/.opencode/test-results/raycast-$(date +%Y-%m-%d)
   cp -r Screenshots/ ~/.opencode/test-results/raycast-$(date +%Y-%m-%d)/
   cp RAYCAST_TEST_REPORT.md ~/.opencode/test-results/raycast-$(date +%Y-%m-%d)/
   ```

2. **Clean up test data**:
   ```bash
   sqlite3 ~/.opencode/sessions/session.db \
     "DELETE FROM user_preferences WHERE user_id = 'test';" \
     "DELETE FROM session_contexts WHERE session_id LIKE 'raycast-test%';" \
     "DELETE FROM tasks WHERE id LIKE 'raycast-test%';"
   ```

3. **File bug reports** if any failures found
4. **Update documentation** based on findings
5. **Share results** with team

---

## Notes

- Server path may vary based on npm installation method
  - Global npm install: `/opt/homebrew/lib/node_modules/@lovellfelix/mcp-session-memory/dist/index.js`
  - Local npm install: `./node_modules/.bin/mcp-session-memory`
  - Bun install: Similar structure but under bun module path

- Response times may vary based on:
  - Database size
  - System load
  - Network latency
  - Number of stored contexts

- Database locking test may not apply if using WAL mode

- Cross-client sync requires:
  - Claude Desktop also configured with same server
  - Same database path (`~/.opencode/sessions/session.db`)
  - Both clients running simultaneously
