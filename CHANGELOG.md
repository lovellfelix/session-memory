# Changelog

All notable changes to the MCP Session Memory Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
