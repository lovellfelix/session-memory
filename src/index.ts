#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { SessionDatabase } from "./database.js";
import { createWebServer } from "./web-server.js";
import { logger } from "./logger.js";
import { performanceTracker } from "./performance.js";
import { apiParser } from "./api-parser.js";
import { handleError } from "./errors.js";
import { readFileSync } from "fs";
import {
  collectContextArtifacts,
  getHarnessAdapters,
  getRuntimeDiagnostics,
} from "./harness-adapters.js";
import { resolveSessionDbPath } from "./runtime-paths.js";

const SESSION_DB_PATH = resolveSessionDbPath();
const ENABLE_DASHBOARD = process.env.ENABLE_DASHBOARD === "true";
const DASHBOARD_PORT = Number.isNaN(Number(process.env.DASHBOARD_PORT))
  ? 3000
  : parseInt(process.env.DASHBOARD_PORT as string, 10);
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || "localhost";
const PROMPT_MODULE_FILENAMES = [
  "system_prompt.md",
  "reasoning_framework.md",
  "response_style.md",
  "user_context.md",
  "modes.md",
  "quality_gate.md",
  "plan.md",
  "workflow.md",
  "implement.md",
  "review-code.md",
] as const;
const CURATED_CONTEXT_FILENAMES = [
  "assistant_rules.md",
  "user_profile.md",
  "work_preferences.md",
  "family_context.md",
] as const;

function normalizeMetadata(metadata: unknown): string | undefined {
  if (metadata === undefined || metadata === null) {
    return undefined;
  }

  if (typeof metadata === "string") {
    return metadata;
  }

  return JSON.stringify(metadata);
}

class SessionMemoryServer {
  private server: Server;
  private db: SessionDatabase;
  private initialized: boolean = false;

  constructor() {
    try {
      logger.info('Initializing session-memory server...', { path: SESSION_DB_PATH });
      
      this.server = new Server(
        {
          name: "@lovellfelix/mcp-session-memory",
          version: "2.0.0",
        },
        {
          capabilities: {
            tools: {},
          },
        }
      );

      logger.info('Creating database connection...');
      this.db = new SessionDatabase(SESSION_DB_PATH);
      
      // Initialize database asynchronously
      this.db.initialize().then(() => {
        this.initialized = true;
        logger.info('Database initialized successfully');
      }).catch(error => {
        logger.error('Failed to initialize database', error);
        process.exit(1);
      });
      
      this.setupToolHandlers();
      
      this.server.onerror = (error) => logger.error('MCP server error', error as Error);
      process.on("SIGINT", async () => {
        logger.info('Received SIGINT, closing database...');
        await this.db.close();
        process.exit(0);
      });
      process.on("uncaughtException", (error) => {
        logger.error('Uncaught exception', error);
        process.exit(1);
      });
      process.on("unhandledRejection", (reason) => {
        logger.error('Unhandled rejection', reason as Error);
        process.exit(1);
      });
      
      logger.info('Server constructor completed successfully');
    } catch (error) {
      logger.error('Fatal error during initialization', error as Error);
      process.exit(1);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.db.initialize();
      this.initialized = true;
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return this.handleToolCall(request);
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: "store_session_context",
        description: "Store session context for later retrieval",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Unique session identifier",
            },
            context_type: {
              type: "string",
              description: "Type of context (conversation, workflow, preference, project)",
            },
            key: {
              type: "string",
              description: "Context key identifier",
            },
            value: {
              type: "string",
              description: "Context value (JSON string for complex data)",
            },
            context_key: {
              type: "string",
              description: "Alias for 'key' (tool compatibility)",
            },
            context_value: {
              type: "string",
              description: "Alias for 'value' (tool compatibility)",
            },
            metadata: {
              type: "object",
              description: "Optional metadata",
              additionalProperties: true,
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key for safe retries",
            },
          },
          required: ["session_id"],
        },
      },
      {
        name: "retrieve_session_context",
        description: "Retrieve stored session context",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier (use '*' for all sessions)",
            },
            context_type: {
              type: "string",
              description: "Filter by context type (optional)",
            },
            key: {
              type: "string",
              description: "Specific key to retrieve (optional)",
            },
            context_key: {
              type: "string",
              description: "Alias for 'key' (tool compatibility)",
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default: 50)",
            },
          },
          required: ["session_id"],
        },
      },
      {
        name: "update_session_context",
        description: "Append to existing session context without overwriting",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier",
            },
            context_type: {
              type: "string",
              description: "Type of context (conversation, workflow, preference, project)",
            },
            key: {
              type: "string",
              description: "Context key identifier",
            },
            additional_value: {
              type: "string",
              description: "Value to append (JSON string for complex data)",
            },
            metadata: {
              type: "object",
              description: "Optional metadata",
              additionalProperties: true,
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key for safe retries",
            },
          },
          required: ["session_id", "context_type", "key", "additional_value"],
        },
      },
      {
        name: "track_user_preference",
        description: "Track and learn user preferences",
        inputSchema: {
          type: "object",
          properties: {
            user_id: {
              type: "string",
              description: "User identifier (defaults to 'default')",
            },
            category: {
              type: "string",
              description: "Preference category (e.g., 'code_style', 'workflow', 'general')",
            },
            preference_key: {
              type: "string",
              description: "Preference identifier",
            },
            preference_value: {
              type: "string",
              description: "Preference value",
            },
            confidence: {
              type: "number",
              description: "Confidence score (0.0-1.0)",
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key for safe retries",
            },
          },
          required: ["category", "preference_key", "preference_value"],
        },
      },
      {
        name: "get_user_preferences",
        description: "Retrieve user preferences",
        inputSchema: {
          type: "object",
          properties: {
            user_id: {
              type: "string",
              description: "User identifier (defaults to 'default')",
            },
            preference_key: {
              type: "string",
              description: "Specific preference key (optional)",
            },
          },
        },
      },
      {
        name: "learn_project_convention",
        description: "Learn and store project-specific conventions",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              description: "Project identifier (git repo path or name)",
            },
            language: {
              type: "string",
              description: "Programming language",
            },
            convention_type: {
              type: "string",
              description: "Type of convention (naming, formatting, pattern, architecture, testing)",
            },
            convention_key: {
              type: "string",
              description: "Convention identifier",
            },
            convention_value: {
              type: "string",
              description: "Convention description or pattern",
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key for safe retries",
            },
          },
          required: [
            "project_id",
            "language",
            "convention_type",
            "convention_key",
            "convention_value",
          ],
        },
      },
      {
        name: "get_project_conventions",
        description: "Retrieve project conventions",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              description: "Project identifier",
            },
            language: {
              type: "string",
              description: "Filter by language (optional)",
            },
            convention_type: {
              type: "string",
              description: "Filter by convention type (optional)",
            },
          },
          required: ["project_id"],
        },
      },
      {
        name: "store_interaction",
        description: "Store a conversation interaction for context",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier",
            },
            role: {
              type: "string",
              description: "Message role (user, assistant, system)",
            },
            content: {
              type: "string",
              description: "Message content",
            },
            metadata: {
              type: "object",
              description: "Optional metadata (agent, workflow, etc.)",
              additionalProperties: true,
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key for safe retries",
            },
          },
          required: ["session_id", "role", "content"],
        },
      },
      {
        name: "get_interaction_history",
        description: "Retrieve conversation history",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier",
            },
            limit: {
              type: "number",
              description: "Maximum number of interactions (default: 20)",
            },
            since: {
              type: "string",
              description: "ISO timestamp to retrieve from (optional)",
            },
          },
          required: ["session_id"],
        },
      },
      {
        name: "cleanup_old_sessions",
        description: "Remove sessions older than specified days",
        inputSchema: {
          type: "object",
          properties: {
            days: {
              type: "number",
              description: "Delete sessions older than N days (default: 30)",
            },
          },
        },
      },
      {
        name: "get_recent_activity",
        description: "Get recent activity for debugging purposes",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of items per category (default: 10)",
            },
          },
        },
      },
      {
        name: "create_task",
        description: "Create a new task in the task tracking system",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Task title",
            },
            description: {
              type: "string",
              description: "Task description (optional)",
            },
            payload_json: {
              type: "string",
              description: "Task payload as JSON string",
            },
            priority: {
              type: "number",
              description: "Task priority (default: 100, lower = higher priority)",
            },
            state: {
              type: "string",
              description: "Task state (queued, in_progress, done, failed, blocked)",
            },
            agent_id: {
              type: "string",
              description: "ID of agent assigned to task (optional)",
            },
            workflow_id: {
              type: "string",
              description: "ID of workflow this task belongs to (optional)",
            },
            parent_task_id: {
              type: "number",
              description: "ID of parent task for subtasks (optional)",
            },
          },
          required: ["title", "payload_json"],
        },
      },
      {
        name: "get_tasks",
        description: "Retrieve tasks with optional filtering",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of tasks to return (default: 100)",
            },
            state: {
              type: "string",
              description: "Filter by task state (queued, in_progress, done, failed, blocked)",
            },
            workflow_id: {
              type: "string",
              description: "Filter by workflow ID (optional)",
            },
            agent_id: {
              type: "string",
              description: "Filter by agent ID (optional)",
            },
          },
        },
      },
      {
        name: "update_task",
        description: "Update an existing task",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Task ID",
            },
            title: {
              type: "string",
              description: "New task title (optional)",
            },
            description: {
              type: "string",
              description: "New task description (optional)",
            },
            state: {
              type: "string",
              description: "New task state (queued, in_progress, done, failed, blocked)",
            },
            priority: {
              type: "number",
              description: "New task priority (optional)",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "delete_task",
        description: "Delete a task by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Task ID to delete",
            },
          },
          required: ["id"],
        },
      },
      // ==================== Search Tools ====================
      {
        name: "memory_search",
        description: "Full-text search across all session contexts using FTS5 with BM25 ranking",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
            context_type: {
              type: "string",
              description: "Filter by context type (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 20)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "search_semantic",
        description: "Semantic similarity search (requires @xenova/transformers)",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language query",
            },
            threshold: {
              type: "number",
              description: "Minimum similarity score 0-1 (default: 0.5)",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 10)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "search_patterns",
        description: "Detect recurring patterns in memory content",
        inputSchema: {
          type: "object",
          properties: {
            min_occurrences: {
              type: "number",
              description: "Minimum occurrences to be considered a pattern (default: 3)",
            },
            context_type: {
              type: "string",
              description: "Filter by context type (optional)",
            },
            pattern_types: {
              type: "array",
              items: { type: "string" },
              description: "Types to search: key, value, convention (default: all)",
            },
          },
        },
      },
      {
        name: "search_temporal",
        description: "Analyze memory patterns over time periods",
        inputSchema: {
          type: "object",
          properties: {
            period_type: {
              type: "string",
              description: "Time period granularity: hour, day, week, month (default: day)",
            },
            start_date: {
              type: "string",
              description: "Start date ISO format (optional)",
            },
            end_date: {
              type: "string",
              description: "End date ISO format (optional)",
            },
            context_type: {
              type: "string",
              description: "Filter by context type (optional)",
            },
          },
        },
      },
      // ==================== Analysis Tools ====================
      {
        name: "analysis_conflicts",
        description: "Detect conflicts between memory entries",
        inputSchema: {
          type: "object",
          properties: {
            context_type: {
              type: "string",
              description: "Filter by context type (optional)",
            },
            project_id: {
              type: "string",
              description: "Filter by project (optional)",
            },
          },
        },
      },
      {
        name: "analysis_memory_map",
        description: "Generate memory map visualization data",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              description: "Filter by project (optional)",
            },
          },
        },
      },
      // ==================== Export/Import Tools ====================
      {
        name: "memory_export",
        description: "Export memories in JSON or Markdown format",
        inputSchema: {
          type: "object",
          properties: {
            format: {
              type: "string",
              description: "Export format: json or markdown (default: json)",
            },
            context_type: {
              type: "string",
              description: "Filter by context type (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum entries to export (default: 1000)",
            },
          },
        },
      },
      {
        name: "memory_import",
        description: "Import memories from JSON",
        inputSchema: {
          type: "object",
          properties: {
            data: {
              type: "string",
              description: "JSON array of memory entries",
            },
            session_id: {
              type: "string",
              description: "Session ID for imported entries (optional)",
            },
            overwrite: {
              type: "boolean",
              description: "Overwrite existing entries (default: false)",
            },
          },
          required: ["data"],
        },
      },
      {
        name: "memory_compact",
        description: "Compact and optimize database storage",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "memory_tags",
        description: "Manage tags for memory entries",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "Action to perform (list, add)",
            },
            memory_id: {
              type: "number",
              description: "Memory ID (required for add)",
            },
            memory_type: {
              type: "string",
              description: "Memory type: session_context, preference, convention",
            },
            tag: {
              type: "string",
              description: "Tag to add (required for add)",
            },
          },
          required: ["action"],
        },
      },
      // ==================== Enhanced Task Tools ====================
      {
        name: "task_board",
        description: "Get visual task board grouped by phase, state, or priority",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              description: "Filter by project (optional)",
            },
            workflow_id: {
              type: "string",
              description: "Filter by workflow (optional)",
            },
            group_by: {
              type: "string",
              description: "Grouping method: phase, state, or priority (default: phase)",
            },
          },
        },
      },
      {
        name: "task_insights",
        description: "Get task analytics and velocity metrics",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              description: "Filter by project (optional)",
            },
            days: {
              type: "number",
              description: "Analysis period in days (default: 30)",
            },
          },
        },
      },
      // ==================== Project Profile Tools ====================
      {
        name: "project_profile",
        description: "Manage project profiles for multi-project support",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "Action to perform (get, create, list)",
            },
            id: {
              type: "string",
              description: "Project ID (required for get/create)",
            },
            name: {
              type: "string",
              description: "Project name (required for create)",
            },
            root_path: {
              type: "string",
              description: "Project root path (optional)",
            },
            primary_language: {
              type: "string",
              description: "Primary programming language (optional)",
            },
            frameworks: {
              type: "array",
              items: { type: "string" },
              description: "Frameworks used (optional)",
            },
            conventions_summary: {
              type: "string",
              description: "Summary of project conventions (optional)",
            },
          },
          required: ["action"],
        },
      },
      // ==================== Routing Pattern Tools ====================
      {
        name: "get_routing_patterns",
        description: "Get learned routing patterns with confidence scores",
        inputSchema: {
          type: "object",
          properties: {
            min_confidence: {
              type: "number",
              description: "Minimum confidence threshold (default: 0.7)",
            },
            limit: {
              type: "number",
              description: "Maximum patterns to return (default: 20)",
            },
          },
        },
      },
      {
        name: "store_routing_pattern",
        description: "Store a successful routing pattern for cross-workflow learning",
        inputSchema: {
          type: "object",
          properties: {
            pattern_key: {
              type: "string",
              description: "Pattern identifier (e.g., 'add-authentication-fastapi')",
            },
            agent_name: {
              type: "string",
              description: "Agent that handled this pattern",
            },
            confidence: {
              type: "number",
              description: "Initial confidence (default: 0.5)",
            },
            file_count: {
              type: "number",
              description: "Number of files involved",
            },
            loc_estimate: {
              type: "number",
              description: "Estimated lines of code",
            },
            metadata: {
              type: "object",
              description: "Additional metadata",
            },
          },
          required: ["pattern_key", "agent_name"],
        },
      },
      {
        name: "find_similar_routing_patterns",
        description: "Find routing patterns similar to a description",
        inputSchema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Workflow description to match",
            },
            min_confidence: {
              type: "number",
              description: "Minimum confidence (default: 0.7)",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 5)",
            },
          },
          required: ["description"],
        },
      },
      // ==================== Batch Operations ====================
      {
        name: "store_contexts_batch",
        description: "Store multiple session contexts in a single transaction (40-60% faster)",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session ID for all contexts",
            },
            contexts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  context_type: { type: "string", description: "Context type (default: 'workflow')" },
                  key: { type: "string", description: "Context key (primary field)" },
                  value: { type: "string", description: "Context value (primary field)" },
                  context_key: { type: "string", description: "Alias for 'key' (tool compatibility)" },
                  context_value: { type: "string", description: "Alias for 'value' (tool compatibility)" },
                  metadata: { type: "object" },
                },
              },
              description: "Array of contexts to store",
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key for safe retries",
            },
          },
          required: ["session_id", "contexts"],
        },
      },
      {
        name: "track_preferences_batch",
        description: "Track multiple preferences in a single transaction (40-60% faster)",
        inputSchema: {
          type: "object",
          properties: {
            user_id: {
              type: "string",
              description: "User ID (default: 'default')",
            },
            preferences: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  preference_key: { type: "string" },
                  preference_value: { type: "string" },
                  confidence: { type: "number" },
                },
                required: ["category", "preference_key", "preference_value"],
              },
              description: "Array of preferences to track",
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key for safe retries",
            },
          },
          required: ["preferences"],
        },
      },
      {
        name: "store_conventions_batch",
        description: "Store multiple conventions in a single transaction (40-60% faster)",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              description: "Project ID",
            },
            language: {
              type: "string",
              description: "Programming language",
            },
            conventions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  convention_type: { type: "string" },
                  convention_key: { type: "string" },
                  convention_value: { type: "string" },
                },
                required: ["convention_type", "convention_key", "convention_value"],
              },
              description: "Array of conventions to store",
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key for safe retries",
            },
          },
          required: ["project_id", "language", "conventions"],
        },
      },
      {
        name: "get_tool_manifest",
        description: "Return machine-readable tool manifest and required-args schemas",
        inputSchema: {
          type: "object",
          properties: {
            include_schemas: {
              type: "boolean",
              description: "Include input schemas (default: true)",
            },
          },
        },
      },
      // ==================== API Ingestion Tools ====================
      {
        name: "store_api_spec",
        description: "Store and parse OpenAPI/Swagger specification",
        inputSchema: {
          type: "object",
          properties: {
            spec_id: {
              type: "string",
              description: "Unique API spec identifier",
            },
            spec_json: {
              type: "string",
              description: "OpenAPI/Swagger spec as JSON string",
            },
            source: {
              type: "string",
              description: "Source URL or file path (optional)",
            },
            source_type: {
              type: "string",
              description: "API specification type (openapi, swagger, feathers, express, fastify)",
            },
          },
          required: ["spec_id", "spec_json", "source_type"],
        },
      },
      {
        name: "get_api_spec",
        description: "Retrieve full API specification by ID",
        inputSchema: {
          type: "object",
          properties: {
            spec_id: {
              type: "string",
              description: "API spec identifier",
            },
          },
          required: ["spec_id"],
        },
      },
      {
        name: "list_api_specs",
        description: "List all stored API specifications with metadata",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "delete_api_spec",
        description: "Delete API specification and all related endpoints/schemas",
        inputSchema: {
          type: "object",
          properties: {
            spec_id: {
              type: "string",
              description: "API spec identifier",
            },
          },
          required: ["spec_id"],
        },
      },
      {
        name: "get_api_endpoints",
        description: "Query API endpoints with filters",
        inputSchema: {
          type: "object",
          properties: {
            spec_id: {
              type: "string",
              description: "Filter by spec ID (optional)",
            },
            path_pattern: {
              type: "string",
              description: "Filter by path pattern (optional)",
            },
            method: {
              type: "string",
              description: "Filter by HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS (optional)",
            },
            tag: {
              type: "string",
              description: "Filter by tag (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 20)",
            },
          },
        },
      },
      {
        name: "get_api_endpoint_detail",
        description: "Get full endpoint details including request/response schemas",
        inputSchema: {
          type: "object",
          properties: {
            spec_id: {
              type: "string",
              description: "API spec identifier",
            },
            path: {
              type: "string",
              description: "Endpoint path",
            },
            method: {
              type: "string",
              description: "HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)",
            },
          },
          required: ["spec_id", "path", "method"],
        },
      },
      {
        name: "search_api_endpoints",
        description: "Full-text search across API endpoints",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query (searches summary, description, tags)",
            },
            spec_id: {
              type: "string",
              description: "Filter by spec ID (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 10)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_api_schema",
        description: "Get schema definition from API spec",
        inputSchema: {
          type: "object",
          properties: {
            spec_id: {
              type: "string",
              description: "API spec identifier",
            },
            schema_name: {
              type: "string",
              description: "Schema name",
            },
          },
          required: ["spec_id", "schema_name"],
        },
      },
      {
        name: "analyze_codebase_apis",
        description: "Analyze codebase for API endpoints (FeathersJS, Express, Fastify)",
        inputSchema: {
          type: "object",
          properties: {
            spec_id: {
              type: "string",
              description: "Spec ID to store results",
            },
            source_path: {
              type: "string",
              description: "Path to source file or directory",
            },
            framework: {
              type: "string",
              description: "Framework to detect: feathers, express, fastify (optional, auto-detect if not provided)",
            },
          },
          required: ["spec_id", "source_path"],
        },
      },
      {
        name: "server_health",
        description: "Check MCP server health and database connectivity",
        inputSchema: {
          type: "object",
          properties: {
            include_stats: {
              type: "boolean",
              description: "Include database statistics (default: false)",
            },
            include_integrity: {
              type: "boolean",
              description: "Run PRAGMA integrity_check and include the result (default: false)",
            },
          },
        },
      },
      {
        name: "record_artifact_read",
        description: "Record that a durable on-disk memory artifact was injected or consulted",
        inputSchema: {
          type: "object",
          properties: {
            artifact_path: { type: "string", description: "Absolute or canonical artifact path" },
            artifact_type: { type: "string", description: "Artifact kind (memory,current,decisions,handoff,promoted,project-artifact)" },
            project_id: { type: "string", description: "Optional project slug" },
            session_id: { type: "string", description: "Optional session identifier" },
            harness: { type: "string", description: "Harness name, e.g. pi or opencode" },
            query: { type: "string", description: "Prompt/query that caused the artifact lookup" },
            score: { type: "number", description: "Optional retrieval score used for ranking" },
            metadata: { type: "object", description: "Optional structured metadata" },
          },
          required: ["artifact_path"],
        },
      },
      {
        name: "get_artifact_reads",
        description: "List recently read durable memory artifacts for feedback and ranking",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string", description: "Optional project slug filter" },
            session_id: { type: "string", description: "Optional session filter" },
            harness: { type: "string", description: "Optional harness filter" },
            artifact_path: { type: "string", description: "Optional exact artifact path filter" },
            limit: { type: "number", description: "Maximum results (default: 20)" },
          },
        },
      },
      {
        name: "get_autodream_metrics",
        description: "List recent autodream runs recorded in the session-memory database",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Optional project slug filter" },
            session_id: { type: "string", description: "Optional session filter" },
            limit: { type: "number", description: "Maximum results (default: 20)" },
          },
        },
      },
      {
        name: "server_stats",
        description: "Get detailed server statistics and performance metrics",
        inputSchema: {
          type: "object",
          properties: {
            include_performance: {
              type: "boolean",
              description: "Include performance metrics (default: true)",
            },
          },
        },
      },
      // ==================== Enhanced Memory Tools (v9) ====================
      {
        name: "store_memory",
        description: "Store a memory with branch awareness, type classification, and importance level",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier",
            },
            key: {
              type: "string",
              description: "Memory key/topic",
            },
            value: {
              type: "string",
              description: "Memory content (JSON string for complex data)",
            },
            memory_type: {
              type: "string",
              description: "Type of memory: decision, preference, learning, task, question, note, progress, info (auto-detected if not provided)",
            },
            importance: {
              type: "string",
              description: "Importance level: critical, high, normal, low (default: normal)",
            },
            git_branch: {
              type: "string",
              description: "Git branch for branch-aware storage (auto-detected if not provided)",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for categorization",
            },
          },
          required: ["session_id", "key", "value"],
        },
      },
      {
        name: "get_memory",
        description: "Get memories by topic with branch awareness",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier",
            },
            topic: {
              type: "string",
              description: "Topic to search for",
            },
            git_branch: {
              type: "string",
              description: "Filter by git branch (optional)",
            },
            memory_type: {
              type: "string",
              description: "Filter by memory type (optional)",
            },
            importance: {
              type: "string",
              description: "Minimum importance level (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 20)",
            },
          },
          required: ["session_id", "topic"],
        },
      },
      {
        name: "query_memory",
        description: "Query memory records by keyword",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Keyword query",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 20)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "update_memory",
        description: "Update an existing memory entry",
        inputSchema: {
          type: "object",
          properties: {
            memory_id: {
              type: "number",
              description: "Memory row identifier",
            },
            value: {
              type: "string",
              description: "Updated memory value",
            },
            metadata: {
              type: "object",
              description: "Optional metadata to merge",
              additionalProperties: true,
            },
          },
          required: ["memory_id", "value"],
        },
      },
      {
        name: "link_memory_to_project",
        description: "Link a memory to a project for operational resurfacing",
        inputSchema: {
          type: "object",
          properties: {
            memory_id: {
              type: "number",
              description: "Memory row identifier",
            },
            project: {
              type: "string",
              description: "Project name",
            },
          },
          required: ["memory_id", "project"],
        },
      },
      {
        name: "daily_briefing",
        description: "Generate proactive daily briefing from operational memory",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "weekly_review",
        description: "Generate weekly review summary from operational memory",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "stale_work_scan",
        description: "Scan for stale work that should be resurfaced",
        inputSchema: {
          type: "object",
          properties: {
            stale_hours: {
              type: "number",
              description: "Hours before work is considered stale (default: 72)",
            },
          },
        },
      },
      {
        name: "assemble_active_context",
        description: "Assemble active context from prompt modules, markdown memory, and SQLite memory",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Current user request for relevance filtering",
            },
            mode: {
              type: "string",
              description: "Reasoning mode (architecture, rfc, debugging, incident, review, slack)",
            },
            session_id: {
              type: "string",
              description: "Session ID to prioritize session-local memory",
            },
            limit: {
              type: "number",
              description: "Limit for memory snippets (default: 8)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "search_memories",
        description: "Full-text search across all memories",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
            git_branch: {
              type: "string",
              description: "Filter by git branch (optional)",
            },
            memory_type: {
              type: "string",
              description: "Filter by memory type (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 20)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "evolve_memory",
        description: "Add an evolution note to track changes over time",
        inputSchema: {
          type: "object",
          properties: {
            memory_id: {
              type: "number",
              description: "ID of the memory to evolve",
            },
            evolution_note: {
              type: "string",
              description: "Note describing the evolution/change",
            },
            new_value: {
              type: "string",
              description: "New value to update to (optional)",
            },
          },
          required: ["memory_id", "evolution_note"],
        },
      },
      {
        name: "get_memory_entities",
        description: "Get all extracted entities from memories",
        inputSchema: {
          type: "object",
          properties: {
            entity_type: {
              type: "string",
              description: "Filter by entity type (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 50)",
            },
          },
        },
      },
      {
        name: "sync_session_start",
        description: "Initialize session with branch context and retrieve relevant memories",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier",
            },
            git_branch: {
              type: "string",
              description: "Current git branch",
            },
            project_id: {
              type: "string",
              description: "Project identifier (optional)",
            },
          },
          required: ["session_id"],
        },
      },
    ];
  }

  private async handleToolCall(request: any) {
    const { name, arguments: args } = request.params;
    const endTimer = performanceTracker.start(`tool:${name}`);

    try {
      // Ensure database is initialized before handling any tool calls
      await this.ensureInitialized();

      switch (name) {
        case "get_tool_manifest": {
          const includeSchemas = args.include_schemas !== false;
          const tools = this.getTools().map((t: any) => {
            if (includeSchemas) return t;
            const { inputSchema, ...rest } = t;
            return rest;
          });
          const runtime = getRuntimeDiagnostics(PROMPT_MODULE_FILENAMES, CURATED_CONTEXT_FILENAMES);
          endTimer();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    server: { name: "@lovellfelix/mcp-session-memory", version: "2.0.0" },
                    db: { path: SESSION_DB_PATH },
                    adapters: getHarnessAdapters(),
                    runtime,
                    tools,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "store_session_context":
          if (args.idempotency_key) {
            const cached = this.db.getIdempotencyResult(name, args.idempotency_key);
            if (cached) {
              endTimer();
              return { content: [{ type: "text", text: cached }] };
            }
          }
          const key = args.key ?? args.context_key;
          const value = args.value ?? args.context_value;
          const contextType = args.context_type ?? "workflow";
          if (!key || !value) {
            throw new Error("store_session_context requires key/value (or context_key/context_value)");
          }
          this.db.storeContext(
            args.session_id,
            contextType,
            key,
            value,
            normalizeMetadata(args.metadata)
          );
          endTimer();
          logger.logToolCall(name, { session_id: args.session_id, key }, Date.now(), true);
          if (args.idempotency_key) {
            this.db.storeIdempotencyResult(name, args.idempotency_key, `Context stored: ${key}`);
          }
          return {
            content: [
              {
                type: "text",
                text: `Context stored: ${key}`,
              },
            ],
          };

        case "retrieve_session_context":
          const retrieveKey = args.key ?? args.context_key;
          const contexts = this.db.retrieveContext(
            args.session_id,
            args.context_type,
            retrieveKey,
            args.limit
          );
          endTimer();
          logger.logToolCall(name, { session_id: args.session_id, count: contexts.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(contexts, null, 2),
              },
            ],
          };

        case "update_session_context":
          if (args.idempotency_key) {
            const cached = this.db.getIdempotencyResult(name, args.idempotency_key);
            if (cached) {
              endTimer();
              return { content: [{ type: "text", text: cached }] };
            }
          }
          this.db.updateContext(
            args.session_id,
            args.context_type,
            args.key,
            args.additional_value,
            normalizeMetadata(args.metadata)
          );
          endTimer();
          logger.logToolCall(name, { session_id: args.session_id, key: args.key }, Date.now(), true);
          if (args.idempotency_key) {
            this.db.storeIdempotencyResult(name, args.idempotency_key, `Context updated: ${args.key}`);
          }
          return {
            content: [
              {
                type: "text",
                text: `Context updated: ${args.key}`,
              },
            ],
          };

        case "track_user_preference":
          if (args.idempotency_key) {
            const cached = this.db.getIdempotencyResult(name, args.idempotency_key);
            if (cached) {
              endTimer();
              return { content: [{ type: "text", text: cached }] };
            }
          }
          logger.debug('track_user_preference called', {
            user_id: args.user_id || "default",
            category: args.category,
            preference_key: args.preference_key,
            preference_value: args.preference_value,
            confidence: args.confidence || 1.0
          });
          this.db.trackPreference(
            args.user_id || "default",
            args.category,
            args.preference_key,
            args.preference_value,
            args.confidence || 1.0
          );
          endTimer();
          logger.logToolCall(name, { category: args.category, key: args.preference_key }, Date.now(), true);
          if (args.idempotency_key) {
            this.db.storeIdempotencyResult(name, args.idempotency_key, `Preference tracked: ${args.preference_key} (category: ${args.category})`);
          }
          return {
            content: [
              {
                type: "text",
                text: `Preference tracked: ${args.preference_key} (category: ${args.category})`,
              },
            ],
          };

        case "get_user_preferences":
          const preferences = this.db.getPreferences(
            args.user_id || "default",
            args.preference_key
          );
          endTimer();
          logger.logToolCall(name, { user_id: args.user_id || "default", count: preferences.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(preferences, null, 2),
              },
            ],
          };

        case "learn_project_convention":
          if (args.idempotency_key) {
            const cached = this.db.getIdempotencyResult(name, args.idempotency_key);
            if (cached) {
              endTimer();
              return { content: [{ type: "text", text: cached }] };
            }
          }
          this.db.learnConvention(
            args.project_id,
            args.language,
            args.convention_type,
            args.convention_key,
            args.convention_value
          );
          endTimer();
          logger.logToolCall(name, { project_id: args.project_id, key: args.convention_key }, Date.now(), true);
          if (args.idempotency_key) {
            this.db.storeIdempotencyResult(name, args.idempotency_key, `Convention learned: ${args.convention_key}`);
          }
          return {
            content: [
              {
                type: "text",
                text: `Convention learned: ${args.convention_key}`,
              },
            ],
          };

        case "get_project_conventions":
          const conventions = this.db.getConventions(
            args.project_id,
            args.language,
            args.convention_type
          );
          endTimer();
          logger.logToolCall(name, { project_id: args.project_id, count: conventions.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(conventions, null, 2),
              },
            ],
          };

        case "store_interaction":
          if (args.idempotency_key) {
            const cached = this.db.getIdempotencyResult(name, args.idempotency_key);
            if (cached) {
              endTimer();
              return { content: [{ type: "text", text: cached }] };
            }
          }
          logger.debug('store_interaction called', {
            session_id: args.session_id,
            role: args.role,
            content_length: args.content?.length || 0,
            metadata: args.metadata ? "present" : "absent"
          });
          this.db.storeInteraction(
            args.session_id,
            args.role,
            args.content,
            normalizeMetadata(args.metadata)
          );
          endTimer();
          logger.logToolCall(name, { session_id: args.session_id, role: args.role }, Date.now(), true);
          if (args.idempotency_key) {
            this.db.storeIdempotencyResult(name, args.idempotency_key, 'Interaction stored');
          }
          return {
            content: [
              {
                type: "text",
                text: "Interaction stored",
              },
            ],
          };

        case "get_interaction_history":
          const history = this.db.getInteractionHistory(
            args.session_id,
            args.limit
          );
          endTimer();
          logger.logToolCall(name, { session_id: args.session_id, count: history.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(history, null, 2),
              },
            ],
          };

        case "cleanup_old_sessions":
          const deleted = this.db.cleanupOldSessions(args.days || 30);
          endTimer();
          logger.logToolCall(name, { days: args.days || 30, deleted }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: `Cleaned up ${deleted} old sessions`,
              },
            ],
          };

        case "get_recent_activity":
          const activity = this.db.getRecentActivity(args.limit || 10);
          endTimer();
          logger.logToolCall(name, { limit: args.limit || 10 }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(activity, null, 2),
              },
            ],
          };

        case "create_task":
          const taskId = this.db.createTask(
            args.title,
            args.description,
            args.payload_json,
            args.priority,
            args.workflow_id,
            args.parent_task_id,
            args.project_id,
            args.phase,
            args.estimated_hours,
            args.tags
          );
          endTimer();
          logger.logToolCall(name, { title: args.title, task_id: taskId }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: `Task created with ID: ${taskId}`,
              },
            ],
          };

        case "get_tasks":
          const tasks = this.db.getTasks({
            limit: args.limit,
            state: args.state,
            workflowId: args.workflow_id,
            agentId: args.agent_id
          });
          endTimer();
          logger.logToolCall(name, { count: tasks.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(tasks, null, 2),
              },
            ],
          };

        case "update_task":
          this.db.updateTask(args.id, {
            title: args.title,
            description: args.description,
            state: args.state,
            priority: args.priority
          });
          endTimer();
          logger.logToolCall(name, { id: args.id }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: "Task updated successfully",
              },
            ],
          };

        case "delete_task":
          const taskDeleted = this.db.deleteTask(args.id);
          endTimer();
          logger.logToolCall(name, { id: args.id, deleted: taskDeleted }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: taskDeleted ? "Task deleted successfully" : "Task not found",
              },
            ],
          };

        // ==================== Search Tools ====================
        case "memory_search":
          const searchResults = this.db.getAnalytics().searchFullText(args.query, {
            limit: args.limit,
            contextType: args.context_type,
          });
          endTimer();
          logger.logToolCall(name, { query: args.query, count: searchResults.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(searchResults, null, 2),
              },
            ],
          };

        case "search_semantic":
          const semanticResults = await this.db.getAnalytics().searchSemantic(args.query, {
            limit: args.limit,
            threshold: args.threshold,
          });
          endTimer();
          logger.logToolCall(name, { query: args.query, count: semanticResults.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(semanticResults, null, 2),
              },
            ],
          };

        case "search_patterns":
          const patterns = this.db.getAnalytics().detectPatterns({
            minOccurrences: args.min_occurrences,
            contextType: args.context_type,
            patternTypes: args.pattern_types,
          });
          endTimer();
          logger.logToolCall(name, { count: patterns.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(patterns, null, 2),
              },
            ],
          };

        case "search_temporal":
          const temporalResults = this.db.getAnalytics().analyzeTemporalPatterns({
            periodType: args.period_type,
            startDate: args.start_date,
            endDate: args.end_date,
            contextType: args.context_type,
          });
          endTimer();
          logger.logToolCall(name, { periods: temporalResults.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(temporalResults, null, 2),
              },
            ],
          };

        // ==================== Analysis Tools ====================
        case "analysis_conflicts":
          const conflicts = this.db.getAnalytics().detectConflicts({
            contextType: args.context_type,
            projectId: args.project_id,
          });
          endTimer();
          logger.logToolCall(name, { count: conflicts.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(conflicts, null, 2),
              },
            ],
          };

        case "analysis_memory_map":
          const memoryMap = this.db.getAnalytics().generateMemoryMap({
            projectId: args.project_id,
          });
          endTimer();
          logger.logToolCall(name, { totalContexts: memoryMap.totalContexts }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(memoryMap, null, 2),
              },
            ],
          };

        // ==================== Export/Import Tools ====================
        case "memory_export":
          const exported = this.db.getAnalytics().exportMemories({
            format: args.format,
            contextType: args.context_type,
            limit: args.limit,
          });
          endTimer();
          logger.logToolCall(name, { format: args.format || 'json' }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: exported,
              },
            ],
          };

        case "memory_import":
          const importResult = this.db.getAnalytics().importMemories(args.data, {
            sessionId: args.session_id,
            overwrite: args.overwrite,
          });
          endTimer();
          logger.logToolCall(name, importResult, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: `Imported: ${importResult.imported}, Skipped: ${importResult.skipped}, Errors: ${importResult.errors}`,
              },
            ],
          };

        case "memory_compact":
          const compactResult = this.db.getAnalytics().compactStorage();
          endTimer();
          logger.logToolCall(name, compactResult, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: `Storage compacted. Reclaimed: ${compactResult.reclaimed} bytes`,
              },
            ],
          };

        case "memory_tags":
          if (args.action === 'list') {
            const tags = this.db.getAnalytics().getTags();
            endTimer();
            logger.logToolCall(name, { action: 'list', count: tags.length }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(tags, null, 2),
                },
              ],
            };
          } else if (args.action === 'add') {
            this.db.getAnalytics().addTag(args.memory_id, args.memory_type, args.tag);
            endTimer();
            logger.logToolCall(name, { action: 'add', tag: args.tag }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: `Tag added: ${args.tag}`,
                },
              ],
            };
          }
          throw new Error(`Unknown memory_tags action: ${args.action}`);

        // ==================== Enhanced Task Tools ====================
        case "task_board":
          const taskBoard = this.db.getTaskBoard({
            projectId: args.project_id,
            includeDone: args.include_done
          });
          endTimer();
          logger.logToolCall(name, { groups: Object.keys(taskBoard).length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(taskBoard, null, 2),
              },
            ],
          };

        case "task_insights":
          const insights = this.db.getTaskInsights({
            projectId: args.project_id
          });
          endTimer();
          logger.logToolCall(name, insights, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(insights, null, 2),
              },
            ],
          };

        // ==================== Project Profile Tools ====================
        case "project_profile":
          if (args.action === 'get') {
            const profile = this.db.getProjectProfile(args.id);
            endTimer();
            logger.logToolCall(name, { action: 'get', id: args.id, found: !!profile }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: profile ? JSON.stringify(profile, null, 2) : "Project not found",
                },
              ],
            };
          } else if (args.action === 'create') {
            const newProfile = this.db.createProjectProfile({
              id: args.id,
              name: args.name,
              root_path: args.root_path,
              primary_language: args.primary_language,
              frameworks: args.frameworks,
              conventions_summary: args.conventions_summary,
            });
            endTimer();
            logger.logToolCall(name, { action: 'create', id: args.id }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(newProfile, null, 2),
                },
              ],
            };
          } else if (args.action === 'list') {
            const profiles = this.db.listProjectProfiles({
              limit: args.limit
            });
            endTimer();
            logger.logToolCall(name, { action: 'list', count: profiles.length }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(profiles, null, 2),
                },
              ],
            };
          }
          throw new Error(`Unknown project_profile action: ${args.action}`);

        // ==================== Routing Pattern Tools ====================
        case "get_routing_patterns":
          const routingPatterns = this.db.getRoutingPatterns(
            args.min_confidence || 0.7,
            args.limit || 20
          );
          endTimer();
          logger.logToolCall(name, { count: routingPatterns.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(routingPatterns, null, 2),
              },
            ],
          };

        case "store_routing_pattern":
          this.db.storeRoutingPattern(
            args.pattern_key,
            args.agent_name,
            args.confidence,
            args.file_count || 0,
            args.loc_estimate || 0,
            normalizeMetadata(args.metadata)
          );
          endTimer();
          logger.logToolCall(name, { pattern_key: args.pattern_key }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: `Routing pattern stored: ${args.pattern_key}`,
              },
            ],
          };

        case "find_similar_routing_patterns":
          const similarPatterns = this.db.findSimilarRoutingPatterns(args.description, {
            minConfidence: args.min_confidence || 0.7,
            limit: args.limit || 5
          });
          endTimer();
          logger.logToolCall(name, { count: similarPatterns.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(similarPatterns, null, 2),
              },
            ],
          };

        // ==================== Batch Operations ====================
        case "store_contexts_batch":
          if (args.idempotency_key) {
            const cached = this.db.getIdempotencyResult(name, args.idempotency_key);
            if (cached) {
              endTimer();
              return { content: [{ type: "text", text: cached }] };
            }
          }
          const batchContexts = args.contexts.map((ctx: any, idx: number) => {
            const key = ctx.key ?? ctx.context_key;
            const value = ctx.value ?? ctx.context_value;
            if (!key || !value) {
              throw new Error(
                `contexts[${idx}] must include key/value (or context_key/context_value)`
              );
            }
            return {
              context_type: ctx.context_type || "workflow",
              // Accept both 'key' (wire protocol) and 'context_key' (tool alias) for backward compatibility
              key,
              value,
              metadata: ctx.metadata,
            };
          });
          const storedCount = this.db.storeContextBatch(args.session_id, batchContexts);
          endTimer();
          logger.logToolCall(name, { count: storedCount }, Date.now(), true);
          if (args.idempotency_key) {
            this.db.storeIdempotencyResult(name, args.idempotency_key, `Stored ${storedCount} contexts`);
          }
          return {
            content: [
              {
                type: "text",
                text: `Stored ${storedCount} contexts`,
              },
            ],
          };

        case "track_preferences_batch":
          if (args.idempotency_key) {
            const cached = this.db.getIdempotencyResult(name, args.idempotency_key);
            if (cached) {
              endTimer();
              return { content: [{ type: "text", text: cached }] };
            }
          }
          const batchPrefs = args.preferences.map((pref: any) => ({
            category: pref.category,
            preference_key: pref.preference_key,
            preference_value: pref.preference_value,
            confidence: pref.confidence,
          }));
          const trackedCount = this.db.trackPreferenceBatch(args.user_id || 'default', batchPrefs);
          endTimer();
          logger.logToolCall(name, { count: trackedCount }, Date.now(), true);
          if (args.idempotency_key) {
            this.db.storeIdempotencyResult(name, args.idempotency_key, `Tracked ${trackedCount} preferences`);
          }
          return {
            content: [
              {
                type: "text",
                text: `Tracked ${trackedCount} preferences`,
              },
            ],
          };

        case "store_conventions_batch":
          if (args.idempotency_key) {
            const cached = this.db.getIdempotencyResult(name, args.idempotency_key);
            if (cached) {
              endTimer();
              return { content: [{ type: "text", text: cached }] };
            }
          }
          const batchConvs = args.conventions.map((conv: any) => ({
            convention_type: conv.convention_type,
            convention_key: conv.convention_key,
            convention_value: conv.convention_value,
          }));
          const convCount = this.db.storeConventionBatch(args.project_id, args.language, batchConvs);
          endTimer();
          logger.logToolCall(name, { count: convCount }, Date.now(), true);
          if (args.idempotency_key) {
            this.db.storeIdempotencyResult(name, args.idempotency_key, `Stored ${convCount} conventions`);
          }
          return {
            content: [
              {
                type: "text",
                text: `Stored ${convCount} conventions`,
              },
            ],
          };

        // ==================== API Ingestion Handlers ====================
        case "store_api_spec":
          const specJson = args.spec_json;
          const parsed = apiParser.parseOpenApiSpec(specJson);
          
          // Store the spec
          const storeResult = this.db.storeApiSpec(
            args.spec_id,
            parsed.title,
            parsed.version,
            specJson,
            args.source || '',
            args.source_type
          );
          
          // Store endpoints
          for (const endpoint of parsed.endpoints) {
            this.db.storeApiEndpoint(
              args.spec_id,
              endpoint.path,
              endpoint.method,
              endpoint.operationId,
              endpoint.summary,
              endpoint.description,
              endpoint.tags,
              endpoint.isDeprecated,
              endpoint.requestBody,
              endpoint.responses
            );
          }
          
          // Store schemas
          for (const schema of parsed.schemas) {
            this.db.storeApiSchema(
              args.spec_id,
              schema.name,
              JSON.stringify(schema.schema)
            );
          }
          
          endTimer();
          logger.logToolCall(name, { 
            spec_id: args.spec_id, 
            endpoints: parsed.endpoints.length, 
            schemas: parsed.schemas.length,
            action: storeResult.inserted ? 'created' : storeResult.updated ? 'updated' : 'unchanged'
          }, Date.now(), true);
          
          return {
            content: [
              {
                type: "text",
                text: `API spec ${storeResult.inserted ? 'stored' : storeResult.updated ? 'updated' : 'unchanged'}: ${parsed.title} v${parsed.version}\nEndpoints: ${parsed.endpoints.length}\nSchemas: ${parsed.schemas.length}`,
              },
            ],
          };

        case "get_api_spec":
          const spec = this.db.getApiSpec(args.spec_id);
          endTimer();
          
          if (!spec) {
            logger.logToolCall(name, { spec_id: args.spec_id, found: false }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: `API spec not found: ${args.spec_id}`,
                },
              ],
            };
          }
          
          logger.logToolCall(name, { spec_id: args.spec_id, found: true }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(spec, null, 2),
              },
            ],
          };

        case "list_api_specs":
          const specs = this.db.listApiSpecs();
          endTimer();
          logger.logToolCall(name, { count: specs.length }, Date.now(), true);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(specs, null, 2),
              },
            ],
          };

        case "delete_api_spec":
          const deletedSpec = this.db.deleteApiSpec(args.spec_id);
          endTimer();
          logger.logToolCall(name, { spec_id: args.spec_id, deleted: deletedSpec }, Date.now(), true);
          
          return {
            content: [
              {
                type: "text",
                text: deletedSpec 
                  ? `API spec deleted: ${args.spec_id}` 
                  : `API spec not found: ${args.spec_id}`,
              },
            ],
          };

        case "get_api_endpoints":
          const endpoints = this.db.getApiEndpoints(
            args.spec_id,
            args.path_pattern,
            args.method,
            args.tag,
            args.limit || 20
          );
          endTimer();
          logger.logToolCall(name, { count: endpoints.length }, Date.now(), true);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(endpoints, null, 2),
              },
            ],
          };

        case "get_api_endpoint_detail":
          const endpointDetail = this.db.getApiEndpointDetail(
            args.spec_id,
            args.path,
            args.method
          );
          endTimer();
          
          if (!endpointDetail) {
            logger.logToolCall(name, { spec_id: args.spec_id, path: args.path, method: args.method, found: false }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: `Endpoint not found: ${args.method} ${args.path}`,
                },
              ],
            };
          }
          
          logger.logToolCall(name, { spec_id: args.spec_id, path: args.path, method: args.method, found: true }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(endpointDetail, null, 2),
              },
            ],
          };

        case "search_api_endpoints":
          const apiSearchResults = this.db.searchApiEndpoints(
            args.query,
            args.spec_id,
            args.limit || 10
          );
          endTimer();
          logger.logToolCall(name, { query: args.query, count: apiSearchResults.length }, Date.now(), true);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(apiSearchResults, null, 2),
              },
            ],
          };

        case "get_api_schema":
          const schema = this.db.getApiSchema(args.spec_id, args.schema_name);
          endTimer();
          
          if (!schema) {
            logger.logToolCall(name, { spec_id: args.spec_id, schema_name: args.schema_name, found: false }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: `Schema not found: ${args.schema_name}`,
                },
              ],
            };
          }
          
          logger.logToolCall(name, { spec_id: args.spec_id, schema_name: args.schema_name, found: true }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(schema, null, 2),
              },
            ],
          };

        case "analyze_codebase_apis":
          const sourceCode = readFileSync(args.source_path, 'utf-8');
          const framework = args.framework || 'feathers'; // Default to feathers
          
          let analyzedEndpoints: any[] = [];
          let analyzedServices: any[] = [];
          
          if (framework === 'feathers') {
            analyzedServices = apiParser.parseFeathersService(sourceCode, args.source_path);
            
            // Store services
            for (const service of analyzedServices) {
              this.db.storeFeathersService(
                args.spec_id,
                service.serviceName,
                service.servicePath,
                service.methods,
                service.hooks,
                service.events,
                service.sourceFile
              );
            }
          } else {
            // Express/Fastify
            analyzedEndpoints = apiParser.parseExpressRoutes(sourceCode, args.source_path);
            
            // Store endpoints
            for (const endpoint of analyzedEndpoints) {
              this.db.storeApiEndpoint(
                args.spec_id,
                endpoint.path,
                endpoint.method,
                undefined,
                endpoint.summary,
                endpoint.description,
                endpoint.tags,
                false
              );
            }
          }
          
          // Create a synthetic spec entry
          this.db.storeApiSpec(
            args.spec_id,
            `${framework} API`,
            '1.0.0',
            JSON.stringify({ 
              framework, 
              source: args.source_path,
              analyzed_at: new Date().toISOString()
            }),
            args.source_path,
            framework
          );
          
          endTimer();
          logger.logToolCall(name, { 
            spec_id: args.spec_id, 
            framework,
            services: analyzedServices.length,
            endpoints: analyzedEndpoints.length
          }, Date.now(), true);
          
          return {
            content: [
              {
                type: "text",
                text: framework === 'feathers'
                  ? `Analyzed FeathersJS services: ${analyzedServices.length}\nServices: ${analyzedServices.map(s => s.servicePath).join(', ')}`
                  : `Analyzed ${framework} routes: ${analyzedEndpoints.length}\nEndpoints: ${analyzedEndpoints.map(e => `${e.method} ${e.path}`).join(', ')}`,
              },
            ],
          };

        case "server_health":
          const isHealthy = this.db.isHealthy();
          let healthStats = null;
          if (args.include_stats) {
            healthStats = this.db.getStats();
          }
          const integrity = args.include_integrity ? this.db.getIntegrityStatus() : null;
          const runtimeDiagnostics = getRuntimeDiagnostics(PROMPT_MODULE_FILENAMES, CURATED_CONTEXT_FILENAMES);
          endTimer();
          logger.logToolCall(name, { healthy: isHealthy, integrity: integrity?.ok }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: isHealthy && (integrity ? integrity.ok : true) ? "healthy" : "unhealthy",
                  timestamp: new Date().toISOString(),
                  database: {
                    connected: isHealthy,
                    path: SESSION_DB_PATH,
                    memory_home: runtimeDiagnostics.database.memoryHome,
                  },
                  integrity,
                  adapters: runtimeDiagnostics.harnesses,
                  config: runtimeDiagnostics.config,
                  stats: healthStats
                }, null, 2),
              },
            ],
          };

        case "record_artifact_read": {
          const insertedId = this.db.recordArtifactRead({
            artifactPath: args.artifact_path,
            artifactType: args.artifact_type,
            projectId: args.project_id,
            sessionId: args.session_id,
            harness: args.harness,
            query: args.query,
            score: args.score,
            metadata: normalizeMetadata(args.metadata),
          });
          endTimer();
          logger.logToolCall(name, { artifact_path: args.artifact_path, insertedId }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: `Artifact read recorded: ${insertedId}`,
              },
            ],
          };
        }

        case "get_artifact_reads": {
          const artifactReads = this.db.getArtifactReads({
            projectId: args.project_id,
            sessionId: args.session_id,
            harness: args.harness,
            artifactPath: args.artifact_path,
            limit: args.limit,
          });
          endTimer();
          logger.logToolCall(name, { count: artifactReads.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(artifactReads, null, 2),
              },
            ],
          };
        }

        case "get_autodream_metrics": {
          const metrics = this.db.getAutodreamMetrics({
            project: args.project,
            sessionId: args.session_id,
            limit: args.limit,
          });
          endTimer();
          logger.logToolCall(name, { count: metrics.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(metrics, null, 2),
              },
            ],
          };
        }

        case "server_stats":
          const dbStats = this.db.getStats();
          let perfMetrics = null;
          if (args.include_performance !== false) {
            perfMetrics = performanceTracker.getAllStats();
            // Convert Map to object for JSON serialization
            const perfObj: Record<string, any> = {};
            for (const [op, stats] of perfMetrics.entries()) {
              perfObj[op] = stats;
            }
            perfMetrics = perfObj;
          }
          endTimer();
          logger.logToolCall(name, { collected: true }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  timestamp: new Date().toISOString(),
                  database: dbStats,
                  performance: perfMetrics
                }, null, 2),
              },
            ],
          };

        // ==================== Enhanced Memory Handlers (v9) ====================
        case "store_memory": {
          // Auto-detect memory type if not provided
          const memoryType = args.memory_type || this.detectMemoryType(args.value);
          const importance = args.importance || 'normal';
          
          // Store context with enhanced metadata
          const metadata = JSON.stringify({
            git_branch: args.git_branch || null,
            memory_type: memoryType,
            importance: importance,
            tags: args.tags || [],
          });
          
          this.db.storeContext(
            args.session_id,
            'memory',
            args.key,
            args.value,
            metadata
          );
          
          // Extract entities from the memory content
          const entities = this.extractEntities(args.key, args.value);
          
          // Get the memory ID to link entities
          if (entities.length > 0) {
            const storedMemory = this.db.getContext(args.session_id, 'memory', args.key, 1);
            if (storedMemory.length > 0 && storedMemory[0].id) {
              this.db.storeMemoryEntities(storedMemory[0].id, entities);
            }
          }
          
          endTimer();
          logger.logToolCall(name, { key: args.key, type: memoryType, importance, entities: entities.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: `Memory stored: ${args.key} (type: ${memoryType}, importance: ${importance}, entities: ${entities.length})`,
              },
            ],
          };
        }

        case "get_memory":
          // Search memories by topic with branch awareness
          const memories = this.db.getContext(args.session_id, 'memory', undefined, args.limit || 20);
          
          // Filter by topic (simple keyword match for now)
          const topicLower = args.topic.toLowerCase();
          const filteredMemories = memories.filter((m: any) => {
            const keyMatch = m.key.toLowerCase().includes(topicLower);
            const valueMatch = m.value.toLowerCase().includes(topicLower);
            
            // Apply branch filter if specified
            if (args.git_branch && m.metadata) {
              try {
                const meta = JSON.parse(m.metadata);
                if (meta.git_branch && meta.git_branch !== args.git_branch) {
                  return false;
                }
              } catch {}
            }
            
            // Apply memory type filter if specified
            if (args.memory_type && m.metadata) {
              try {
                const meta = JSON.parse(m.metadata);
                if (meta.memory_type !== args.memory_type) {
                  return false;
                }
              } catch {}
            }
            
            return keyMatch || valueMatch;
          });
          
          endTimer();
          logger.logToolCall(name, { topic: args.topic, count: filteredMemories.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(filteredMemories, null, 2),
              },
            ],
          };

        case "query_memory": {
          const matches = this.db.queryMemory(args.query, args.limit || 20);
          endTimer();
          logger.logToolCall(name, { query: args.query, count: matches.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(matches, null, 2),
              },
            ],
          };
        }

        case "update_memory": {
          const metadata = args.metadata ? JSON.stringify(args.metadata) : undefined;
          const updated = this.db.updateMemory(args.memory_id, args.value, metadata);
          endTimer();
          logger.logToolCall(name, { memory_id: args.memory_id, updated }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: updated ? `Memory updated: ${args.memory_id}` : `Memory not found: ${args.memory_id}`,
              },
            ],
          };
        }

        case "link_memory_to_project": {
          const link = this.db.linkMemoryToProject(args.memory_id, args.project);
          endTimer();
          logger.logToolCall(name, { memory_id: args.memory_id, project_id: link.projectId, linked: link.linked }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(link, null, 2),
              },
            ],
          };
        }

        case "daily_briefing": {
          const briefing = this.db.getDailyBriefing();
          endTimer();
          logger.logToolCall(name, { generated: true }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(briefing, null, 2),
              },
            ],
          };
        }

        case "weekly_review": {
          const review = this.db.getWeeklyReview();
          endTimer();
          logger.logToolCall(name, { generated: true }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(review, null, 2),
              },
            ],
          };
        }

        case "stale_work_scan": {
          const stale = this.db.getStaleWorkScan(args.stale_hours || 72);
          endTimer();
          logger.logToolCall(name, { stale_hours: args.stale_hours || 72 }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(stale, null, 2),
              },
            ],
          };
        }

        case "assemble_active_context": {
          const { promptModules, curatedMarkdown } = collectContextArtifacts(
            PROMPT_MODULE_FILENAMES,
            CURATED_CONTEXT_FILENAMES,
          );
          const queryText = `${args.query || ''} ${args.mode || ''}`.trim();
          const relevantMemory = queryText ? this.db.queryMemory(queryText, args.limit || 8) : [];
          const sessionData = args.session_id
            ? this.db.getContext(args.session_id, undefined, undefined, 12)
            : [];

          const activeContext = {
            assembled_at: new Date().toISOString(),
            mode: args.mode || 'default',
            strategy: 'relevance-filtered',
            prompt_modules: promptModules,
            curated_markdown: curatedMarkdown,
            sqlite_memory: relevantMemory,
            session_data: sessionData,
            note: 'Only relevance-filtered context is returned; full DB is never injected.',
          };

          endTimer();
          logger.logToolCall(name, { mode: args.mode || 'default', modules: promptModules.length, memories: relevantMemory.length }, Date.now(), true);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(activeContext, null, 2),
              },
            ],
          };
        }

        case "search_memories":
          // Use FTS if available, fallback to LIKE
          const searchMemories = this.db.getAnalytics().searchFullText(args.query, {
            limit: args.limit || 20,
            contextType: 'memory',
          });
          
          endTimer();
          logger.logToolCall(name, { query: args.query, count: searchMemories.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(searchMemories, null, 2),
              },
            ],
          };

        case "evolve_memory":
          // Store evolution note
          // For now, we'll update the context with an evolution note appended
          const existingMemory = this.db.getContext(
            '', // Any session
            'memory', 
            undefined, 
            1000
          ).find((m: any) => m.id === args.memory_id);
          
          if (existingMemory) {
            const existingMeta = existingMemory.metadata ? JSON.parse(existingMemory.metadata) : {};
            const evolutions = existingMeta.evolutions || [];
            evolutions.push({
              note: args.evolution_note,
              previous_value: args.new_value ? existingMemory.value : null,
              timestamp: new Date().toISOString(),
            });
            existingMeta.evolutions = evolutions;
            
            // Update the memory
            if (args.new_value) {
              this.db.storeContext(
                existingMemory.session_id,
                existingMemory.context_type,
                existingMemory.key,
                args.new_value,
                JSON.stringify(existingMeta)
              );
            }
            
            endTimer();
            logger.logToolCall(name, { memory_id: args.memory_id, evolved: true }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: `Memory evolved: ${args.evolution_note}`,
                },
              ],
            };
          }
          
          endTimer();
          logger.logToolCall(name, { memory_id: args.memory_id, evolved: false }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: `Memory not found: ${args.memory_id}`,
              },
            ],
          };

        case "get_memory_entities": {
          // Return entities from the memory_entities table
          const dbEntities = this.db.getMemoryEntities(args.entity_type, args.limit || 50);
          
          // If no entities in DB yet, fall back to on-the-fly extraction
          if (dbEntities.length === 0) {
            const allMemories = this.db.getContext('', 'memory', undefined, 500);
            const entityMap = new Map<string, { count: number; type: string }>();
            
            for (const mem of allMemories) {
              const extracted = this.extractEntities(mem.key, mem.value);
              for (const ent of extracted) {
                if (!args.entity_type || ent.type === args.entity_type) {
                  const existing = entityMap.get(ent.name);
                  if (existing) {
                    existing.count++;
                  } else {
                    entityMap.set(ent.name, { count: 1, type: ent.type });
                  }
                }
              }
            }
            
            const fallbackResults = Array.from(entityMap.entries())
              .map(([name, data]) => ({ name, count: data.count, type: data.type }))
              .sort((a, b) => b.count - a.count)
              .slice(0, args.limit || 50);
            
            endTimer();
            logger.logToolCall(name, { count: fallbackResults.length, source: 'fallback' }, Date.now(), true);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(fallbackResults, null, 2),
                },
              ],
            };
          }
          
          const entitiesResult = dbEntities.map(e => ({
            name: e.entity_name,
            type: e.entity_type,
            count: e.count,
          }));
          
          endTimer();
          logger.logToolCall(name, { count: entitiesResult.length, source: 'database' }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(entitiesResult, null, 2),
              },
            ],
          };
        }

        case "sync_session_start": {
          // Initialize session and return context summary
          const sessionMemories = this.db.getContext(args.session_id, undefined, undefined, 100);
          const userPrefs = this.db.getPreferences('default');
          
          // Get critical and high importance memories
          const criticalMemories = sessionMemories.filter((m: any) => {
            try {
              const meta = JSON.parse(m.metadata || '{}');
              return meta.importance === 'critical' || meta.importance === 'high';
            } catch { return false; }
          });
          
          // Build topic summary
          const topicCounts = new Map<string, number>();
          for (const mem of sessionMemories) {
            const key = mem.key.split('/')[0];
            topicCounts.set(key, (topicCounts.get(key) || 0) + 1);
          }
          
          const syncResult = {
            b: args.git_branch || 'main',
            t: Object.fromEntries(topicCounts),
            c: criticalMemories.slice(0, 5).map((m: any) => ({
              id: m.id,
              s: m.key,
              t: JSON.parse(m.metadata || '{}').memory_type || 'info',
            })),
            n: sessionMemories.length,
            prefs: userPrefs.length,
          };
          
          endTimer();
          logger.logToolCall(name, { session_id: args.session_id, memories: sessionMemories.length }, Date.now(), true);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(syncResult, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      endTimer();
      logger.error(`Tool call failed: ${name}`, error as Error, { args });
      return handleError(error as Error, { tool: name, args });
    }
  }

  /**
   * Detect memory type from content using keyword patterns.
   * Based on git-notes-memory classification approach.
   */
  private detectMemoryType(value: string): string {
    const valueLower = value.toLowerCase();
    
    // Decision patterns
    if (/\b(decided|chose|picked|selected|opted|going with|will use|choosing)\b/.test(valueLower)) {
      return 'decision';
    }
    
    // Preference patterns  
    if (/\b(prefer|favorite|like best|rather|better to|always use|my style)\b/.test(valueLower)) {
      return 'preference';
    }
    
    // Learning patterns
    if (/\b(learned|studied|understood|realized|discovered|figured out|now know)\b/.test(valueLower)) {
      return 'learning';
    }
    
    // Task patterns
    if (/\b(todo|task|need to|plan to|next step|going to|should|must|will)\b/.test(valueLower)) {
      return 'task';
    }
    
    // Question patterns
    if (/\b(wondering|curious|research|investigate|find out|how do|what is|why does)\b/.test(valueLower)) {
      return 'question';
    }
    
    // Note patterns
    if (/\b(noticed|observed|important|remember that|note:|fyi|heads up)\b/.test(valueLower)) {
      return 'note';
    }
    
    // Progress patterns
    if (/\b(completed|finished|done|achieved|milestone|shipped|deployed|released)\b/.test(valueLower)) {
      return 'progress';
    }
    
    // Default to info
    return 'info';
  }

  /**
   * Extract entities from memory content using pattern matching.
   * Based on git-notes-memory entity extraction approach.
   */
  private extractEntities(key: string, value: string): Array<{ name: string; type: string }> {
    const entities: Array<{ name: string; type: string }> = [];
    const seen = new Set<string>();
    
    const addEntity = (name: string, type: string) => {
      const normalized = name.trim();
      if (normalized.length >= 2 && !seen.has(normalized.toLowerCase())) {
        seen.add(normalized.toLowerCase());
        entities.push({ name: normalized, type });
      }
    };
    
    const combined = `${key} ${value}`;
    
    // Extract hashtags: #cooking, #urgent, #react
    const hashtagMatches = combined.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/g);
    if (hashtagMatches) {
      for (const tag of hashtagMatches) {
        addEntity(tag.slice(1), 'hashtag');
      }
    }
    
    // Extract quoted phrases: "machine learning", "user authentication"
    const quotedMatches = combined.match(/"([^"]{2,50})"/g);
    if (quotedMatches) {
      for (const quoted of quotedMatches) {
        addEntity(quoted.slice(1, -1), 'phrase');
      }
    }
    
    // Extract technology names (capitalized words that look like tech)
    const techPatterns = [
      /\b(React|Vue|Angular|Next\.js|Nuxt|Svelte|Solid)\b/g,
      /\b(Python|JavaScript|TypeScript|Go|Rust|Kotlin|Java|Ruby|PHP)\b/g,
      /\b(PostgreSQL|MySQL|MongoDB|Redis|SQLite|Prisma|Drizzle)\b/g,
      /\b(FastAPI|Django|Flask|Express|Fastify|NestJS|Spring)\b/g,
      /\b(Docker|Kubernetes|AWS|GCP|Azure|Vercel|Railway)\b/g,
      /\b(Git|GitHub|GitLab|npm|yarn|pnpm|bun)\b/g,
      /\b(REST|GraphQL|gRPC|WebSocket|OAuth|JWT)\b/g,
      /\b(Tailwind|shadcn|MUI|Chakra|Bootstrap)\b/g,
    ];
    
    for (const pattern of techPatterns) {
      const matches = combined.match(pattern);
      if (matches) {
        for (const match of matches) {
          addEntity(match, 'technology');
        }
      }
    }
    
    // Extract file paths
    const pathMatches = combined.match(/\b[\w./\\-]+\.(ts|tsx|js|jsx|py|go|rs|kt|java|md|json|yaml|yml)\b/g);
    if (pathMatches) {
      for (const path of pathMatches) {
        addEntity(path, 'file');
      }
    }
    
    // Extract URLs
    const urlMatches = combined.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g);
    if (urlMatches) {
      for (const url of urlMatches) {
        // Extract domain as entity
        try {
          const domain = new URL(url).hostname;
          addEntity(domain, 'url');
        } catch {
          // Invalid URL, skip
        }
      }
    }
    
    // Extract capitalized multi-word names (likely project/feature names)
    // e.g., "User Authentication", "Task Manager", "Session Memory"
    const capitalizedMatches = combined.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
    if (capitalizedMatches) {
      for (const name of capitalizedMatches) {
        // Filter out common phrases
        if (!/^(The |A |An |In |On |At |For |With )/.test(name)) {
          addEntity(name, 'name');
        }
      }
    }
    
    return entities;
  }

  async run() {
    try {
      // Ensure database is fully initialized before proceeding
      await this.ensureInitialized();
      
      logger.info('Starting stdio transport...');
      const transport = new StdioServerTransport();
      
      logger.info('Connecting server to transport...');
      await this.server.connect(transport);
      
      logger.info('Session Memory MCP server running on stdio', {
        node_version: process.version,
        database: SESSION_DB_PATH
      });

      if (ENABLE_DASHBOARD) {
        logger.info(`Starting dashboard on http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
        try {
          await createWebServer({
            port: DASHBOARD_PORT,
            host: DASHBOARD_HOST,
            database: this.db,
          });
          logger.info('Dashboard started successfully');
        } catch (e) {
          logger.error('Dashboard failed to start', e as Error);
          logger.info('Continuing without dashboard...');
        }
      }

      try {
        const stats = this.db.getStats();
        logger.info('Database status', stats);
      } catch (e) {
        logger.warn('Could not get database stats', e);
      }

      if (!this.db.isHealthy()) {
        throw new Error("Database health check failed");
      }
      
      logger.info('Server initialization complete - ready for requests');
    } catch (error) {
      logger.error('Fatal error during server startup', error as Error);
      throw error;
    }
  }
}

const server = new SessionMemoryServer();
server.run().catch(console.error);
