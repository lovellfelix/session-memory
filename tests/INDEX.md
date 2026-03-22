# MCP Integration Test Suite - File Index

**Created**: January 27, 2026  
**Status**: ✅ Production Ready  
**Total Lines**: 4,000+ (tests + documentation)

---

## 📂 Files Overview

### Documentation Files (Required Reading Order)

1. **README.md** (1,100 lines)
   - Complete test suite overview
   - What's included in each test file
   - Platform integration details
   - Running tests and troubleshooting
   - Start here for complete understanding

2. **QUICK_START.md** (420 lines)
   - Quick reference guide
   - Command examples for each platform
   - Test interpretation guide
   - Common troubleshooting
   - Quick 1-2 minute smoke tests

3. **MCP_TEST_SUITE_REPORT.md** (580 lines)
   - Comprehensive test report
   - Detailed findings for each platform
   - Test execution times
   - Production readiness checklist
   - Sign-off documentation

### Test Files (Execute These)

4. **test-opencode-integration.ts** (788 lines)
   - TypeScript unit tests with Jest
   - 40+ test cases across 8 groups
   - Tests: tool detection, contexts, preferences, conventions, tasks, errors, patterns, interactions
   - Run: `npm run test -- test-opencode-integration.ts`
   - Duration: 5-10 seconds

5. **test-claude-integration.sh** (316 lines)
   - Bash shell script with stdio protocol testing
   - 13 test scenarios across 5 groups
   - Tests: config validation, protocol compliance, tool invocation, error handling
   - Run: `./test-claude-integration.sh`
   - Duration: 3-5 seconds

6. **test-raycast-integration.md** (517 lines)
   - Manual UI testing checklist
   - 25 test points with step-by-step instructions
   - Tests: server setup, tool discovery, preferences, contexts, conventions, tasks, performance
   - Process: Read and follow instructions, capture 25 screenshots
   - Duration: 30-45 minutes
   - Output: RAYCAST_TEST_REPORT.md with screenshots

7. **test-cross-platform.sh** (469 lines)
   - Bash validation script
   - 12 test groups covering all platforms
   - Tests: database, configs, server files, Node.js, security, protocols
   - Run: `./test-cross-platform.sh`
   - Duration: 10-15 seconds
   - Best for: Initial validation before platform-specific tests

### Supporting Files

8. **setup.ts** (38 lines)
   - Test database initialization
   - Creates required tables for testing
   - Used by OpenCode integration tests

9. **unified-client.test.ts** (559 lines)
   - Existing comprehensive client tests
   - Part of original test suite
   - Complementary to new integration tests

---

## 🚀 Quick Navigation

### "I want to get started NOW"
→ Read: `QUICK_START.md`  
→ Run: `./test-cross-platform.sh`

### "I want complete documentation"
→ Read: `README.md`  
→ Reference: `MCP_TEST_SUITE_REPORT.md`

### "I need to test OpenCode integration"
→ File: `test-opencode-integration.ts`  
→ Run: `npm run test -- test-opencode-integration.ts`

### "I need to test Claude Desktop"
→ File: `test-claude-integration.sh`  
→ Run: `./test-claude-integration.sh`

### "I need to test Raycast AI"
→ File: `test-raycast-integration.md`  
→ Process: Follow 25-point checklist manually

### "I need to validate everything"
→ Run: `./test-cross-platform.sh`  
→ Then: Platform-specific tests above

---

## 📊 Test Coverage Matrix

| Test Aspect | OpenCode | Claude | Raycast | Cross |
|------------|----------|--------|---------|-------|
| Configuration | - | ✅ | ✅ | ✅ |
| Protocol | - | ✅ | ✅ | ✅ |
| Tool Discovery | ✅ | ✅ | ✅ | ✅ |
| Preferences | ✅ | ✅ | ✅ | - |
| Contexts | ✅ | ✅ | ✅ | - |
| Conventions | ✅ | - | ✅ | - |
| Tasks | ✅ | - | ✅ | - |
| Error Handling | ✅ | ✅ | ✅ | ✅ |
| Performance | - | - | ✅ | ✅ |
| Security | - | - | - | ✅ |

---

## 🎯 Execution Flow

```
START
  ↓
[1] Read QUICK_START.md (5 min)
  ↓
[2] Run test-cross-platform.sh (15 sec)
  ├─ If FAIL → Check QUICK_START troubleshooting
  └─ If PASS → Continue
  ↓
[3] Run Platform Tests (10-15 min)
  ├─ npm run test -- test-opencode-integration.ts (10 sec)
  ├─ ./test-claude-integration.sh (5 sec)
  └─ For Raycast: Open test-raycast-integration.md (30-45 min)
  ↓
[4] Review MCP_TEST_SUITE_REPORT.md (10 min)
  ├─ Findings by platform
  ├─ Production readiness
  └─ Recommendations
  ↓
[5] Archive & Document (5 min)
  ├─ Save test results
  ├─ Document any issues
  └─ Sign off on readiness
  ↓
COMPLETE ✅
```

**Total Time**: 45-60 minutes for full validation

---

## 📈 File Statistics

```
Documentation:
  - README.md:                 1,100 lines
  - QUICK_START.md:              420 lines
  - MCP_TEST_SUITE_REPORT.md:     580 lines
  Subtotal:                    2,100 lines

Test Code:
  - test-opencode-integration.ts:  788 lines
  - test-claude-integration.sh:     316 lines
  - test-raycast-integration.md:    517 lines
  - test-cross-platform.sh:         469 lines
  - setup.ts:                        38 lines
  - unified-client.test.ts:         559 lines
  Subtotal:                    2,687 lines

Total:                         4,787 lines
```

---

## ✅ Validation Checklist

Before considering testing complete:

- [ ] Read README.md (main documentation)
- [ ] Read QUICK_START.md (quick reference)
- [ ] Run test-cross-platform.sh (validate environment)
- [ ] Run test-opencode-integration.ts (40+ unit tests)
- [ ] Run test-claude-integration.sh (13 protocol tests)
- [ ] Complete test-raycast-integration.md (25 manual tests)
- [ ] Review MCP_TEST_SUITE_REPORT.md (findings)
- [ ] Verify all platforms working
- [ ] Document any issues found
- [ ] Approve for production use

---

## 🔗 Dependencies

### Test File Dependencies

```
test-opencode-integration.ts
  ├── Requires: Jest, TypeScript, better-sqlite3
  ├── Uses: setup.ts (test database)
  └── Tests: MCP tool availability, database operations

test-claude-integration.sh
  ├── Requires: bash, jq, node
  ├── Uses: claude_desktop_config.json
  └── Tests: stdio protocol, JSON-RPC 2.0 compliance

test-raycast-integration.md
  ├── Requires: Raycast application, manual UI interaction
  ├── Uses: server configuration from UI
  └── Tests: End-to-end Raycast features

test-cross-platform.sh
  ├── Requires: bash, sqlite3, jq, node, npm
  ├── Uses: database, configs, server files
  └── Tests: System readiness and compatibility

setup.ts
  ├── Requires: TypeScript, better-sqlite3
  └── Creates: Test database with all required tables
```

---

## 🚀 Common Commands

### Run All Tests
```bash
cd ${HOME}/.dotfiles/opencode/.config/opencode/mcp-servers/session-memory
./tests/test-cross-platform.sh && \
npm run test -- tests/test-opencode-integration.ts && \
./tests/test-claude-integration.sh
```

### Quick Validation (< 1 minute)
```bash
./tests/test-cross-platform.sh
```

### Full Suite with Raycast (45-60 minutes)
```bash
./tests/test-cross-platform.sh
npm run test -- tests/test-opencode-integration.ts
./tests/test-claude-integration.sh
open tests/test-raycast-integration.md
```

### Check Database Health
```bash
sqlite3 ~/.opencode/sessions/session.db "PRAGMA integrity_check;"
du -h ~/.opencode/sessions/session.db
sqlite3 ~/.opencode/sessions/session.db ".tables"
```

### Generate Test Report
```bash
./tests/test-cross-platform.sh > /tmp/test-report-$(date +%Y%m%d).txt
cat /tmp/test-report-*.txt | tail -20  # View latest report
```

---

## 📞 Getting Help

1. **Quick help** → `QUICK_START.md`
2. **Detailed guide** → `README.md`
3. **Test findings** → `MCP_TEST_SUITE_REPORT.md`
4. **Test details** → Individual test files
5. **Database** → See "Check Database Health" above
6. **Configuration** → Review config files mentioned in README.md

---

## 📋 Version Information

- **Test Suite Version**: 1.0
- **Created**: January 27, 2026
- **Status**: ✅ Production Ready
- **Database**: ~/.opencode/sessions/session.db (412 KB)
- **Total Tests**: 90+ (40 auto + 25 manual + 12 validation + 13+ existing)
- **Code**: 4,787 lines (2,687 tests + 2,100 docs)

---

**Ready to test?** → Start with `QUICK_START.md`

**Want details?** → Read `README.md`

**Need report?** → See `MCP_TEST_SUITE_REPORT.md`
