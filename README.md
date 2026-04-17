# MCP Session Memory Server

This README still contains some historical material from earlier revisions. For the current runtime, treat `src/index.ts`, `src/database.ts`, and `src/runtime-paths.ts` as the source of truth. See `docs/PORTABILITY-RFC.md` for the current portability plan across Pi, OpenCode, and other MCP harnesses.

A Model Context Protocol (MCP) server for persistent session context, user preferences, project conventions, and related indexed state.

**Version 2.0.0** - Enhanced with analytics, search, batch operations, and cross-workflow learning.

## Features

### Core Features
- **Session Context Management**: Store and retrieve workflow state across conversations
- **User Preferences**: Learn and adapt to user coding styles with confidence scoring
- **Project Conventions**: Track and apply project-specific patterns per language
- **Interaction History**: Complete conversation and decision audit trail
- **Task Management**: Track workflow tasks with state transitions and priorities
- **Web Dashboard**: Modern, responsive UI for viewing and managing all data
- **SQLite Storage**: Efficient, reliable, single-file database (~60KB initial size)

### New in v2.0.0
- **Full-Text Search**: FTS5 with BM25 ranking for fast memory search
- **Semantic Search**: Optional vector similarity search (requires @xenova/transformers)
- **Pattern Detection**: Detect recurring patterns in memory content
- **Temporal Analysis**: Analyze memory patterns over time periods
- **Conflict Detection**: Identify conflicting conventions or preferences
- **Memory Visualization**: Generate memory map data for visualization
- **Project Profiles**: Multi-project support with stack detection
- **Routing Patterns**: Cross-workflow learning with confidence scoring
- **Batch Operations**: 40-60% faster bulk inserts via transactions
- **Export/Import**: JSON and Markdown export with import support
- **Enhanced Tasks**: Phases, progress tracking, and velocity metrics

## Quick Start

### Installation (Portable Setup)

The MCP servers are built automatically when you run the dotfiles `bootstrap.sh`. For manual setup:

```bash
# Run the setup script from the mcp-servers directory
~/.config/opencode/mcp-servers/setup.sh

# Or check if already built
~/.config/opencode/mcp-servers/setup.sh --check

# Force rebuild (e.g., after Node.js update)
~/.config/opencode/mcp-servers/setup.sh --clean
```

**What the setup script does:**
1. Checks for prerequisites (Node.js >= 18, build tools)
2. Installs npm dependencies
3. Compiles TypeScript to JavaScript
4. Verifies the server can load

**Runtime note:** the main MCP server uses `sql.js` for portable storage. Some optional helper paths and tests still use `better-sqlite3`; that dependency is not required for the core stdio server.

### Client Configuration

**OpenCode** (pre-configured in `opencode.json`):
```json
{
  "mcp": {
    "session-memory": {
      "command": ["node", "~/.config/opencode/mcp-servers/session-memory/dist/index.js"]
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "session-memory": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/.config/opencode/mcp-servers/session-memory/dist/index.js"]
    }
  }
}
```

**Raycast AI** (use "Install Server" command):
- **Command**: `node`
- **Args**: `["/Users/YOUR_USERNAME/.config/opencode/mcp-servers/session-memory/dist/index.js"]`
- **SESSION_DB**: `/Users/YOUR_USERNAME/.agents/memory/session.db`

Get your paths: `echo "$HOME/.config/opencode/mcp-servers/session-memory/dist/index.js"`

**Note**: Raycast and Claude Desktop require absolute paths (no `~` expansion). OpenCode expands `~` automatically.

See [MCP-SERVER-INTEGRATION-GUIDE.md](../../MCP-SERVER-INTEGRATION-GUIDE.md) for detailed setup instructions.

### Using the Web Dashboard

The dashboard provides a visual interface to view and manage all session data:

```bash
# Start dashboard (background mode)
npm run dashboard:start

# Check dashboard status
npm run dashboard:status

# View dashboard logs
npm run dashboard:logs

# Stop dashboard
npm run dashboard:stop

# Restart dashboard
npm run dashboard:restart

# Check dashboard health
npm run dashboard:health
```

Dashboard will be available at: http://localhost:3001

## Web Dashboard

### Features

- **Session Contexts**: View and search all stored session contexts
- **User Preferences**: Browse learned preferences with confidence scores
- **Project Conventions**: Explore project-specific patterns by language
- **Interaction History**: Review conversation history with metadata
- **Tasks**: Monitor workflow tasks with state transitions
- **Real-time Updates**: Live refresh and filtering
- **Dark Mode**: Toggle between light and dark themes
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Accessibility**: WCAG 2.1 AA compliant

### Configuration

Configuration is done via environment variables. Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | 3001 | Server port |
| `DASHBOARD_HOST` | localhost | Server host (use 0.0.0.0 for all interfaces) |
| `SESSION_DB_PATH` | ~/.agents/memory/session.db | Database file path |
| `MCP_DASHBOARD_TOKEN` | (none) | Bearer token for API authentication |
| `ENABLE_CORS` | true | Enable Cross-Origin Resource Sharing |
| `LOG_LEVEL` | info | Log level (error, warn, info, debug, trace) |
| `OPEN_BROWSER` | false | Auto-open browser on startup |

#### Example Production Configuration

```env
DASHBOARD_PORT=8080
DASHBOARD_HOST=0.0.0.0
MCP_DASHBOARD_TOKEN=your-secure-token-here
ENABLE_CORS=false
LOG_LEVEL=warn
```

### Authentication

The dashboard supports optional bearer token authentication:

1. **Generate a secure token**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Set the token in `.env`**:
   ```env
   MCP_DASHBOARD_TOKEN=your-generated-token
   ```

3. **Use the token in API requests**:
   ```bash
   curl -H "Authorization: Bearer your-generated-token" \
     http://localhost:3001/api/contexts
   ```

**Note**: Leave `MCP_DASHBOARD_TOKEN` empty to disable authentication (not recommended for production).

### Health Check Endpoints

The dashboard provides health check endpoints for monitoring:

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `/api/health` | Full health status | Server stats, database info, uptime |
| `/api/health/ready` | Readiness check | Database schema version |
| `/api/health/live` | Liveness check | Simple ping response |

**Example**:
```bash
# Full health check
curl http://localhost:3001/api/health

# Readiness check (for Kubernetes)
curl http://localhost:3001/api/health/ready

# Liveness check (for load balancers)
curl http://localhost:3001/api/health/live
```

### Management Scripts

The `scripts/dashboard` script provides comprehensive management:

```bash
# Start dashboard in background
./scripts/dashboard start

# Stop dashboard gracefully
./scripts/dashboard stop

# Restart dashboard
./scripts/dashboard restart

# Check status with health info
./scripts/dashboard status

# View logs (last 50 lines)
./scripts/dashboard logs

# Follow logs in real-time
./scripts/dashboard logs -f

# Open dashboard in browser
./scripts/dashboard open

# Perform health check
./scripts/dashboard health

# Show help
./scripts/dashboard help
```

**Features**:
- PID file tracking (`.dashboard.pid`)
- Log file (`.dashboard.log`)
- Background daemon mode
- Graceful shutdown with timeout
- Force kill if needed
- Health check integration
- Auto-build if needed
- Platform-specific browser opening (macOS, Linux, Windows)
- Colored output for better visibility
- `.env` file support

## MCP Server Integration

This server integrates with Claude Desktop, Raycast AI, and OpenCode via the Model Context Protocol.

### Claude Desktop Setup

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "session-memory": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/.config/opencode/mcp-servers/session-memory/dist/index.js"],
      "env": {
        "SESSION_DB": "/Users/YOUR_USERNAME/.agents/memory/session.db"
      }
    }
  }
}
```

Get your actual paths:
```bash
echo "Server: $HOME/.config/opencode/mcp-servers/session-memory/dist/index.js"
echo "Database: $HOME/.agents/memory/session.db"
```

**Note**: Claude Desktop requires absolute paths. Replace `YOUR_USERNAME` with your username.

## MCP Tools

### Context Management (3 tools)
- `store_session_context` - Store workflow state, decisions, active tasks
- `retrieve_session_context` - Resume from previous session with full context
- `store_contexts_batch` - Store multiple context rows efficiently

### User Preferences (2 tools)
- `track_user_preference` - Learn user preferences with confidence scoring
- `get_user_preferences` - Get learned preferences for better personalization

### Project Conventions (2 tools)
- `learn_project_convention` - Learn project-specific patterns by language
- `get_project_conventions` - Apply learned conventions consistently

### Interaction History (2 tools)
- `store_interaction` - Track conversation history with metadata
- `get_interaction_history` - Access conversation context and decisions

### Task Management (4 tools)
- `create_task` - Create workflow tasks with state, priority, and metadata
- `get_tasks` - Retrieve tasks with filtering by session, state, or priority
- `update_task` - Update task state, priority, or metadata
- `delete_task` - Remove completed or cancelled tasks

### Memory and Task Tools
- `query_memory` - Search stored memory records by keyword
- `assemble_active_context` - Build an active context bundle from memory
- `stale_work_scan` - Find work that should be resurfaced
- `daily_briefing` - Generate a proactive daily briefing
- `weekly_review` - Generate a weekly review summary
- `task_board` - Visual task board grouped by phase/state/priority

### Routing Pattern Tools (3 tools) - NEW in v2.0
- `get_routing_patterns` - Get learned patterns with confidence scores
- `store_routing_pattern` - Store successful routing patterns
- `find_similar_routing_patterns` - Find patterns similar to a description

### Batch Operations (3 tools) - NEW in v2.0
- `store_contexts_batch` - Store multiple contexts in single transaction (40-60% faster)
- `track_preferences_batch` - Track multiple preferences in single transaction
- `store_conventions_batch` - Store multiple conventions in single transaction

### API Management (8 tools)
- `store_api_spec` - Store OpenAPI/Swagger specs with hash-based change detection
- `list_api_specs` - List all stored API specs with version and endpoint counts
- `delete_api_spec` - Delete API spec and all related endpoints/schemas
- `get_api_endpoints` - Query endpoints by spec, path pattern, method, or tag
- `get_api_endpoint_detail` - Get full endpoint details including request/response schemas
- `search_api_endpoints` - Full-text search across endpoint summaries and descriptions
- `get_api_schema` - Retrieve specific schema definition from an API spec
- `ensureApiDocsTables` - Initialize API docs tables when needed

### Maintenance (3 tools)
- `cleanup_old_sessions` - Remove sessions older than N days (default: 30)
- `server_stats` - Get database statistics
- `server_health` - Run MCP health checks

## Usage Examples

### Storing Session Context

```typescript
await store_session_context({
  session_id: "auth-feature-2024",
  context_key: "workflow:summary",
  context_value: "Implementing OAuth2 authentication with JWT tokens",
  metadata: JSON.stringify({ workflow: "authentication", phase: "implementation" })
});
```

### Tracking User Preferences

```typescript
await track_user_preference({
  user_id: "default",
  preference_key: "string_quotes",
  preference_value: "double",
  confidence: 0.9
});
```

### Learning Project Conventions

```typescript
await learn_project_convention({
  project_id: "opencode",
  language: "typescript",
  convention_type: "error_handling",
  convention_key: "result_types",
  convention_value: "Result<T, E> types instead of exceptions"
});
```

### Search and Analytics (v2.0)

```typescript
// Full-text search across stored memory
await query_memory({
  query: "authentication jwt",
  limit: 10
});

// Build active context bundle
await assemble_active_context({
  query: "authentication jwt",
  limit: 8
});
```

### Batch Operations (v2.0)

```typescript
// Store multiple contexts in one transaction (40-60% faster)
await store_contexts_batch({
  session_id: "feature-123",
  contexts: [
    { context_type: "workflow", context_key: "step1", context_value: "planning" },
    { context_type: "workflow", context_key: "step2", context_value: "implementation" },
    { context_type: "workflow", context_key: "step3", context_value: "testing" }
  ]
});

// Track multiple preferences at once
await track_preferences_batch({
  user_id: "default",
  preferences: [
    { category: "code_style", preference_key: "quotes", preference_value: "double", confidence: 0.9 },
    { category: "code_style", preference_key: "semicolons", preference_value: "always", confidence: 0.85 }
  ]
});
```

### Routing Patterns for Cross-Workflow Learning (v2.0)

```typescript
// Store a successful routing pattern
await mcp.callTool("store_routing_pattern", {
  pattern_key: "add-authentication-fastapi",
  agent_name: "python-coder",
  confidence: 0.5,
  file_count: 3,
  loc_estimate: 150
});

// Find similar patterns for a new task
await mcp.callTool("find_similar_routing_patterns", {
  description: "implement user login with OAuth",
  min_confidence: 0.7,
  limit: 5
});
```

### Task and Project Views

```typescript
await task_board({ include_done: false });

await get_project_conventions({
  project_id: "my-app",
  language: "typescript"
});
```

## Development

### Building

```bash
# Build TypeScript + minify CSS
npm run build

# Watch mode (development)
npm run dev

# Build CSS only
npm run build:css
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Test accessibility
npm run test:a11y
```

### Scripts

Additional helper scripts in `scripts/`:

- `backup-cron.sh` - Database backup automation
- `health-check-db.sh` - Database health checks
- `health-check-server.sh` - Server health checks
- `monitor-production.sh` - Production monitoring
- `restore-backup.sh` - Restore from backup
- `rollback-database.sh` - Database rollback
- `diagnose-workflow-issue.sh` - Workflow debugging
- `dashboard` - Dashboard management (start/stop/status/logs)

## Database

The SQLite database is stored at `~/.agents/memory/session.db` by default (legacy fallback: `~/.opencode/sessions/session.db`).

### Schema Version

Current schema version: **8**

### Tables

- `session_contexts` - Session state and workflow context
- `user_preferences` - Learned user preferences with confidence scores
- `project_conventions` - Project-specific patterns by language
- `interactions` - Conversation history and decisions
- `tasks` - Workflow tasks with state transitions
- `task_phases` - Task phase definitions with ordering (v6+)
- `project_profiles` - Multi-project support with stack info (v7+)
- `routing_patterns` - Cross-workflow pattern learning (v7+)
- `memory_analytics` - Analytics cache for search optimization (v8+)
- `memory_tags` - Tag system for memory entries (v8+)
- `schema_version` - Database schema version tracking

### Inspection

```bash
# View stored conventions
sqlite3 ~/.agents/memory/session.db \
  "SELECT * FROM project_conventions LIMIT 5;"

# View learned preferences
sqlite3 ~/.agents/memory/session.db \
  "SELECT * FROM user_preferences LIMIT 5;"

# View session history
sqlite3 ~/.agents/memory/session.db \
  "SELECT * FROM session_contexts ORDER BY updated_at DESC LIMIT 10;"

# View routing patterns (v2.0)
sqlite3 ~/.agents/memory/session.db \
  "SELECT pattern_key, agent_name, confidence, success_count FROM routing_patterns ORDER BY confidence DESC LIMIT 10;"

# View project profiles (v2.0)
sqlite3 ~/.agents/memory/session.db \
  "SELECT id, name, primary_language, memory_count FROM project_profiles ORDER BY last_accessed DESC LIMIT 5;"
```

## REST API Endpoints

The web dashboard exposes REST API endpoints for integration:

### Core Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Database statistics |
| `/api/contexts` | GET | List session contexts |
| `/api/preferences` | GET | List user preferences |
| `/api/conventions` | GET | List project conventions |
| `/api/interactions` | GET | List interactions |
| `/api/tasks` | GET | List tasks |
| `/api/tasks/:id` | PUT | Update task |
| `/api/tasks/:id` | DELETE | Delete task |
| `/api/contexts/:id` | DELETE | Delete context |

### Health Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Full health status |
| `/api/health/ready` | GET | Readiness check |
| `/api/health/live` | GET | Liveness check |

### Analytics Endpoints (v2.0)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/search` | GET | Full-text search |
| `/api/patterns` | GET | Detect patterns |
| `/api/temporal` | GET | Temporal analysis |
| `/api/conflicts` | GET | Detect conflicts |
| `/api/memory-map` | GET | Memory visualization |
| `/api/export` | GET | Export memories |
| `/api/compact` | POST | Optimize database |

### Task Board Endpoints (v2.0)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/task-board` | GET | Visual task board |
| `/api/task-insights` | GET | Task analytics |

### Project Endpoints (v2.0)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List projects |
| `/api/projects/:id` | GET | Get project |
| `/api/projects` | POST | Create project |

### Routing Pattern Endpoints (v2.0)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/routing-patterns` | GET | List patterns |
| `/api/routing-patterns` | POST | Store pattern |
| `/api/routing-patterns/similar` | GET | Find similar patterns |

## Deployment

### Docker

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
COPY public ./public

ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=3001
ENV SESSION_DB_PATH=/data/session.db

EXPOSE 3001
VOLUME /data

CMD ["node", "dist/index.js"]
```

Run with Docker:

```bash
docker build -t mcp-session-memory .
docker run -p 3001:3001 \
  -v ~/.agents/memory:/data \
  -e MCP_DASHBOARD_TOKEN=your-token \
  mcp-session-memory
```

### Systemd Service (Linux)

Create `/etc/systemd/system/mcp-dashboard.service`:

```ini
[Unit]
Description=MCP Session Memory Dashboard
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/session-memory
EnvironmentFile=/etc/mcp-session-memory/.env
ExecStart=/usr/bin/node /path/to/session-memory/start-dashboard.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable mcp-dashboard
sudo systemctl start mcp-dashboard
sudo systemctl status mcp-dashboard
```

## Troubleshooting

### Dashboard won't start

1. **Database initialization error or optional helper mismatch**:
   
   The core server does not require `better-sqlite3`, but some optional helper paths and legacy tests do. If a helper complains about `NODE_MODULE_VERSION mismatch`, rebuild the optional native dependency:
   ```bash
   npm rebuild better-sqlite3
   ```
   
   Typical reasons:
   - Switch Node.js versions (for example via `nvm` or `volta`)
   - Upgrade Node.js
   - Copy `node_modules` from another machine

2. **Check if port is in use**:
   ```bash
   lsof -i :3001
   ```

3. **Check logs**:
   ```bash
   npm run dashboard:logs
   ```

4. **Verify database exists**:
   ```bash
   ls -la ~/.agents/memory/session.db
   ```

### Authentication failures

1. **Verify token is set correctly**:
   ```bash
   echo $MCP_DASHBOARD_TOKEN
   ```

2. **Test without authentication**:
   ```bash
   unset MCP_DASHBOARD_TOKEN
   npm run dashboard:start
   ```

### Database errors

1. **Check database health**:
   ```bash
   ./scripts/health-check-db.sh
   ```

2. **Restore from backup**:
   ```bash
   ./scripts/restore-backup.sh
   ```

## Contributing

Contributions are welcome! Please ensure:

1. TypeScript compiles without errors: `npm run build`
2. Tests pass: `npm test`
3. Accessibility tests pass: `npm run test:a11y`
4. CSS is minified: `npm run build:css`

## License

MIT License - see LICENSE file for details

## Author

Repository maintainer

## Related Documentation

- [MCP Server Integration Guide](../../MCP-SERVER-INTEGRATION-GUIDE.md)
- [OpenCode Agents Reference](../../AGENTS.md)
- [Examples](../../EXAMPLES.md)
