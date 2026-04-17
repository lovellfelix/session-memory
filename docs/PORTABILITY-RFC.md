# Session Memory Portability RFC

## Status
- Phase 1 and Phase 2 portability work implemented.
- Target: make `mcp/session-memory` safer and more portable across Pi, OpenCode, Claude Desktop, Raycast, and generic MCP stdio clients.

## Motivation

The server has a useful feature set, but portability was limited by:
- OpenCode-specific path and config assumptions in core runtime code
- duplicated DB path resolution across modules and scripts
- stale docs referring to non-existent helper files and mandatory `better-sqlite3`
- brittle cross-platform validation scripts
- a large, mixed-responsibility runtime surface

## Goals
- Centralize runtime path resolution.
- Support Pi, OpenCode, and generic MCP harnesses without hardcoded machine paths.
- Keep legacy OpenCode paths working during migration.
- Make context assembly harness-aware instead of OpenCode-only.
- Improve validation so portability regressions are easier to detect.

## Non-Goals for Phase 1
- Replacing the current `sql.js` storage model.
- Redesigning the full MCP tool surface.
- Rewriting the legacy `better-sqlite3`-based test suite.
- Splitting the repo into packages.

## Current Risks

### 1. Shared storage semantics
The main server loads the database into memory and writes full snapshots back to disk. That is portable, but it is not the safest model for multi-writer access across multiple harnesses and helper scripts.

### 2. Harness coupling
OpenCode-specific prompt and memory directories leaked into the generic `assemble_active_context` tool, making Pi and other harnesses second-class citizens.

### 3. Validation drift
Some tests validate a legacy schema and helper access pattern rather than the real server contract.

## Architecture Direction

### A. Central runtime path resolver
Introduce a single runtime-path module that owns:
- memory home resolution
- canonical DB path
- legacy DB fallback
- config search and save paths
- project-local DB location
- encryption key location
- harness context roots

### B. Harness-aware context sources
Treat prompt/module context as inputs from adapters instead of fixed OpenCode directories.

Phase 1 adapter model:
- `generic`: `SESSION_MEMORY_CONTEXT_ROOT`
- `opencode`: `${OPENCODE_CONFIG_ROOT:-~/.config/opencode}`
- `pi`: `${PI_AGENT_ROOT:-~/.pi/agent}`

### C. Portable defaults with legacy fallback
Preferred defaults:
- user config: `~/.config/session-memory/config.json`
- user memory home: `~/.agents/memory/`
- project-local DB: `./.session-memory/memory.db`

Legacy fallbacks retained for compatibility:
- `~/.opencode/sessions/session.db`
- `~/.opencode/session-memory.json`
- `./.nova/config.json`
- `./.nova/memory.db`

## Phase 1 Changes

### Implemented
- Added `src/runtime-paths.ts` for shared path resolution.
- Updated `src/index.ts` to use shared DB resolution and multi-harness context sources.
- Updated `src/config.ts` to use portable config search/save paths and project DB defaults.
- Updated `src/enhanced-infrastructure.ts` so encryption key storage uses shared path resolution instead of an OpenCode-only path.
- Fixed `tests/test-cross-platform.sh`:
  - avoids `((x++))` failures under `set -e`
  - derives project root from the script location
  - resolves canonical and legacy DB paths
  - removes hardcoded machine-local repo paths
- Updated `README.md` to point at current runtime files and clarify that `better-sqlite3` is optional for the core server.

### Implemented in Phase 2
- Introduced harness adapter discovery and diagnostics in `src/harness-adapters.ts`.
- Exposed adapter/runtime metadata in `get_tool_manifest` and `server_health`.
- Replaced the old OpenCode integration test with real stdio MCP contract tests against the running server.
- Added adapter-focused tests for context collection and runtime diagnostics.

### Deferred
- reduce tool-surface size or split optional tools
- replace the snapshot-write storage model
- add MCP resources/prompts alongside tools
- add Pi-specific end-to-end tests beyond adapter-aware context assembly coverage

## Recommended Phase 3
- Move to a clearer storage strategy:
  - either single-writer MCP ownership
  - or true file-backed SQLite concurrency with WAL and tighter access rules
- Add stronger readiness checks:
  - schema version
  - writable DB path
  - pending flush state
  - context source discovery

## Compatibility Notes
- Existing `SESSION_DB` and `SESSION_DB_PATH` env vars continue to work.
- New portable env vars are preferred:
  - `SESSION_MEMORY_HOME`
  - `SESSION_MEMORY_DB`
  - `SESSION_MEMORY_CONFIG`
  - `SESSION_MEMORY_CONTEXT_ROOT`
  - `SESSION_MEMORY_PROJECT_DB`
  - `PI_AGENT_ROOT`
  - `OPENCODE_CONFIG_ROOT`
  - `SESSION_ENCRYPTION_KEY_FILE`

## Rollout Recommendation
- Keep legacy fallbacks for at least one release.
- Emit migration notes in the changelog/README.
- Add a future warning when legacy-only paths are selected automatically.
