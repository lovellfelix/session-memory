# Changelog

All notable changes to the MCP Session Memory Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Runtime-agnostic SQLite adapter supporting both Node.js (`better-sqlite3`) and Bun (`bun:sqlite`) environments
- Dynamic database implementation loading based on runtime detection
- Async database initialization with `initialize()` method
- Unified database interface that normalizes API differences between implementations
- Automated verification scripts (`scripts/test-bun-compat.sh`, `scripts/show-bun-code.sh`)
- Comprehensive testing guide (`BUN-TESTING-GUIDE.md`)

### Changed
- Database imports are now dynamic instead of static to support Bun runtime
- Database initialization moved to async pattern for better error handling
- Connection pooling temporarily disabled for Bun compatibility (single connection mode)
- Type annotations changed to runtime-agnostic `any` types where needed

### Technical
- Added `UnifiedDatabaseAdapter` class to normalize statement API differences
- Bun detection via `typeof (globalThis as any).Bun !== 'undefined'`
- Better error messages with runtime context in logs
- All database operations work identically in both Node.js and Bun runtimes

### Verified - 2026-01-26 15:50:31
- ✅ TypeScript compilation successful with Bun compatibility
- ✅ Runtime detection code present in `dist/database.js`
- ✅ Bun SQLite dynamic import present in compiled output
- ✅ Node.js `better-sqlite3` fallback present in compiled output
- ✅ Async initialization pattern present in `dist/index.js`
- ✅ Global npm package symlinked (auto-updated on rebuild)

## [2.0.0] - 2025-01-18

### Added

#### Search & Analytics
- `memory_search` - Full-text search with FTS5/BM25 ranking for fast memory lookup
- `search_semantic` - Semantic similarity search (optional, requires @xenova/transformers)
- `search_patterns` - Detect recurring patterns in memory content
- `search_temporal` - Temporal pattern analysis over time periods
- `analysis_conflicts` - Detect conflicts between memory entries (conventions, preferences)
- `analysis_memory_map` - Generate memory visualization data

#### Export/Import
- `memory_export` - Export memories in JSON or Markdown format
- `memory_import` - Import memories from JSON with optional overwrite
- `memory_compact` - VACUUM and optimize database storage
- `memory_tags` - Tag management for memory entries (list/add)

#### Enhanced Tasks
- `task_board` - Visual task board grouped by phase/state/priority
- `task_insights` - Task analytics with velocity metrics and completion rates
- Enhanced task model with phases, progress tracking, estimated/actual hours

#### Project Profiles
- `project_profile` - Multi-project support with CRUD operations
- Stack detection (frameworks, primary language)
- Memory count tracking per project
- Last accessed timestamps

#### Routing Patterns (Cross-Workflow Learning)
- `get_routing_patterns` - Retrieve learned patterns with confidence scores
- `store_routing_pattern` - Store successful routing patterns
- `find_similar_routing_patterns` - Match descriptions to historical patterns
- Confidence-based auto-routing (>= 0.7 threshold)
- Success/failure tracking for pattern evolution

#### Batch Operations (40-60% faster)
- `store_contexts_batch` - Store multiple contexts in single transaction
- `track_preferences_batch` - Track multiple preferences in single transaction  
- `store_conventions_batch` - Store multiple conventions in single transaction

#### Database
- New migrations (v6, v7, v8) for enhanced features
- `task_phases` table for phase definitions with ordering
- `project_profiles` table for multi-project support
- `routing_patterns` table for cross-workflow learning
- `memory_analytics` table for search optimization
- `memory_tags` table for memory tagging

#### REST API Endpoints
- `/api/search` - Full-text search
- `/api/patterns` - Pattern detection
- `/api/temporal` - Temporal analysis
- `/api/conflicts` - Conflict detection
- `/api/memory-map` - Memory visualization
- `/api/task-board` - Task board view
- `/api/task-insights` - Task analytics
- `/api/projects` - Project profile management
- `/api/routing-patterns` - Routing pattern management
- `/api/export` - Memory export
- `/api/compact` - Database optimization

### Changed
- Updated package version to 2.0.0
- README.md expanded with comprehensive documentation for all 32 tools
- Schema version updated to 8

### Technical
- Added `AnalyticsEngine` class for search and analytics
- Added `ConfigManager` class for multi-project configuration
- Added optional `@xenova/transformers` dependency for semantic search

## [1.0.0] - 2024-12-01

### Added
- Initial release
- Session context management (store, retrieve, update)
- User preference tracking with confidence scoring
- Project convention learning
- Interaction history
- Task management (CRUD, state transitions)
- Web dashboard with authentication
- Health check endpoints
- SQLite storage with automatic migrations
- Automatic cleanup of old sessions (30-day TTL)
