import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SessionDatabase } from "./database.js";
import { logger } from "./logger.js";
import { performanceTracker } from "./performance.js";
import { timingSafeEqual } from "crypto";

export interface WebServerOptions {
  port: number;
  host: string;
  database: SessionDatabase;
  apiToken?: string;
}

// Timing-safe token comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still perform comparison to maintain constant time
    const dummy = Buffer.alloc(a.length);
    timingSafeEqual(Buffer.from(a), dummy);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function createWebServer(options: WebServerOptions) {
  const { port, host, database, apiToken } = options;
  
  // Get token from options or environment
  const authToken = apiToken || process.env.MCP_DASHBOARD_TOKEN;
  const authEnabled = !!authToken;

  const fastify = Fastify({
    logger: false,
  });

  // Restrict CORS to localhost only (dashboard is local-only)
  await fastify.register(fastifyCors, {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3100',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3100',
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
    ],
  });

  // Add security headers including Content Security Policy
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Content-Security-Policy', 
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; " +
      "font-src 'self'; " +
      "connect-src 'self'"
    );
  });

  // Authentication middleware for protected routes
  const authenticateRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!authEnabled) {
      return; // No auth configured, allow all requests
    }

    // Skip auth for health endpoints and static files
    const publicPaths = ['/api/health', '/api/health/live', '/api/health/ready'];
    if (publicPaths.some(path => request.url.startsWith(path)) || !request.url.startsWith('/api/')) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      logger.warn('Missing authorization header', { path: request.url, ip: request.ip });
      return reply.status(401).send({
        success: false,
        error: 'Authorization header required',
        hint: 'Use "Authorization: Bearer <token>" header'
      });
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      logger.warn('Invalid authorization scheme', { path: request.url, ip: request.ip });
      return reply.status(401).send({
        success: false,
        error: 'Invalid authorization scheme',
        hint: 'Use "Authorization: Bearer <token>" format'
      });
    }

    if (!secureCompare(token, authToken)) {
      logger.warn('Invalid API token', { path: request.url, ip: request.ip });
      return reply.status(403).send({
        success: false,
        error: 'Invalid API token'
      });
    }
  };

  // Register auth hook for all routes
  fastify.addHook('preHandler', authenticateRequest);
  
  if (authEnabled) {
    logger.info('API authentication enabled', { protectedRoutes: '/api/*', publicRoutes: ['/api/health*', 'static files'] });
  } else {
    logger.warn('API authentication disabled - set MCP_DASHBOARD_TOKEN to enable');
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const publicRoot = join(__dirname, "..", "public");
  await fastify.register(fastifyStatic, {
    root: publicRoot,
    prefix: "/",
  });

  fastify.get("/api/stats", async (_request, reply) => {
    const endTimer = performanceTracker.start('api:stats');
    try {
      const stats = database.getStats();
      endTimer();
      return { 
        success: true, 
        data: {
          session_contexts: stats.sessionContexts.count,
          user_preferences: stats.userPreferences.count,
          project_conventions: stats.projectConventions.count,
          interactions: stats.interactions.count,
          tasks: stats.tasks?.total?.count || 0
        }
      };
    } catch (error) {
      endTimer();
      logger.error('API stats endpoint failed', error as Error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      session_id?: string;
      context_type?: string;
      key?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/contexts", async (request, reply) => {
    const endTimer = performanceTracker.start('api:contexts');
    try {
      const { session_id, context_type, key, limit, offset } = request.query;

      const limitNum = limit ? parseInt(limit) : 50;
      const offsetNum = offset ? parseInt(offset) : 0;

      if (!session_id) {
        return reply.status(400).send({
          success: false,
          error: "session_id is required"
        });
      }

      // Get all results then slice for pagination
      const allResults = database.retrieveContext(
        session_id,
        context_type,
        key,
        1000 // Get a large number to implement our own pagination
      );

      const total = allResults.length;
      const paginatedResults = allResults.slice(offsetNum, offsetNum + limitNum);

      endTimer();
      return { 
        success: true, 
        data: paginatedResults,
        pagination: {
          total: total,
          offset: offsetNum,
          limit: limitNum,
          hasMore: offsetNum + limitNum < total
        }
      };
    } catch (error) {
      endTimer();
      logger.error('API contexts endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      user_id?: string;
      preference_key?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/preferences", async (request, reply) => {
    const endTimer = performanceTracker.start('api:preferences');
    try {
      const { user_id = "default", preference_key, limit, offset } = request.query;

      const limitNum = limit ? parseInt(limit) : 50;
      const offsetNum = offset ? parseInt(offset) : 0;

      // Get all results then slice for pagination
      const allResults = database.getPreferences(
        user_id, 
        preference_key
      );

      const total = allResults.length;
      const paginatedResults = allResults.slice(offsetNum, offsetNum + limitNum);

      endTimer();
      return { 
        success: true, 
        data: paginatedResults,
        pagination: {
          total: total,
          offset: offsetNum,
          limit: limitNum,
          hasMore: offsetNum + limitNum < total
        }
      };
    } catch (error) {
      endTimer();
      logger.error('API preferences endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      project_id?: string;
      language?: string;
      convention_type?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/conventions", async (request, reply) => {
    const endTimer = performanceTracker.start('api:conventions');
    try {
      const { project_id, language, convention_type, limit, offset } = request.query;

      const limitNum = limit ? parseInt(limit) : 50;
      const offsetNum = offset ? parseInt(offset) : 0;

      // Get all results then slice for pagination
      const allResults = database.getConventions(
        project_id || "all",
        language,
        convention_type
      );

      const total = allResults.length;
      const paginatedResults = allResults.slice(offsetNum, offsetNum + limitNum);

      endTimer();
      return { 
        success: true, 
        data: paginatedResults,
        pagination: {
          total: total,
          offset: offsetNum,
          limit: limitNum,
          hasMore: offsetNum + limitNum < total
        }
      };
    } catch (error) {
      endTimer();
      logger.error('API conventions endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      state?: string;
      workflow_id?: string;
      agent_id?: string;
    };
  }>("/api/tasks", async (request, reply) => {
    const endTimer = performanceTracker.start('api:tasks');
    try {
      const { limit, offset, state, workflow_id, agent_id } = request.query;

      const limitNum = limit ? parseInt(limit) : 100;
      const offsetNum = offset ? parseInt(offset) : 0;

      // Get all results then slice for pagination
      const allResults = database.getTasks({
        state,
        workflowId: workflow_id,
        agentId: agent_id,
        limit: 10000 // Get a large number for pagination
      });

      const total = allResults.length;
      const paginatedResults = allResults.slice(offsetNum, offsetNum + limitNum);

      endTimer();
      return { 
        success: true, 
        data: paginatedResults,
        pagination: {
          total: total,
          offset: offsetNum,
          limit: limitNum,
          hasMore: offsetNum + limitNum < total
        }
      };
    } catch (error) {
      endTimer();
      logger.error('API tasks endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      session_id?: string;
      role?: string;
    };
  }>("/api/interactions", async (request, reply) => {
    const endTimer = performanceTracker.start('api:interactions');
    try {
      const { limit, offset, session_id, role } = request.query;

      const limitNum = limit ? parseInt(limit) : 50;
      const offsetNum = offset ? parseInt(offset) : 0;

      if (session_id) {
        // Session-scoped query (existing behaviour)
        const allResults = database.getInteractions(session_id, 1000);
        const filteredResults = role
          ? allResults.filter(i => i.role === role)
          : allResults;
        const total = filteredResults.length;
        const paginatedResults = filteredResults.slice(offsetNum, offsetNum + limitNum);
        endTimer();
        return {
          success: true,
          data: paginatedResults,
          pagination: {
            total,
            offset: offsetNum,
            limit: limitNum,
            hasMore: offsetNum + limitNum < total
          }
        };
      }

      // Dashboard/all-interactions query (no session_id filter)
      const { data: paginatedResults, total } = database.getAllInteractions(limitNum, offsetNum, role);
      endTimer();
      return {
        success: true,
        data: paginatedResults,
        pagination: {
          total,
          offset: offsetNum,
          limit: limitNum,
          hasMore: offsetNum + limitNum < total
        }
      };
    } catch (error) {
      endTimer();
      logger.error('API interactions endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      user_id?: string;
      category?: string;
      preference_key?: string;
      preference_value?: string;
      confidence?: number;
    };
  }>("/api/preferences/:id", async (request, reply) => {
    const endTimer = performanceTracker.start('api:update_preference');
    try {
      const id = parseInt(request.params.id);
      if (isNaN(id)) {
        endTimer();
        return reply.status(400).send({ success: false, error: "Invalid ID" });
      }
      const updated = database.updatePreference(id, request.body);
      endTimer();
      if (!updated) {
        return reply.status(404).send({ success: false, error: "Preference not found" });
      }
      return { success: true, message: "Preference updated successfully" };
    } catch (error) {
      endTimer();
      logger.error('API update preference endpoint failed', error as Error, { params: request.params, body: request.body });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.delete<{
    Params: { id: string };
  }>("/api/preferences/:id", async (request, reply) => {
    const endTimer = performanceTracker.start('api:delete_preference');
    try {
      const id = parseInt(request.params.id);
      if (isNaN(id)) {
        endTimer();
        return reply.status(400).send({ success: false, error: "Invalid ID" });
      }
      const deleted = database.deletePreference(id);
      endTimer();
      if (!deleted) {
        return reply.status(404).send({ success: false, error: "Preference not found" });
      }
      return { success: true, message: "Preference deleted successfully" };
    } catch (error) {
      endTimer();
      logger.error('API delete preference endpoint failed', error as Error, { params: request.params });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.delete<{
    Params: { id: string };
  }>("/api/conventions/:id", async (request, reply) => {
    const endTimer = performanceTracker.start('api:delete_convention');
    try {
      const id = parseInt(request.params.id);
      if (isNaN(id)) {
        endTimer();
        return reply.status(400).send({ success: false, error: "Invalid ID" });
      }
      const deleted = database.deleteConvention(id);
      endTimer();
      if (!deleted) {
        return reply.status(404).send({ success: false, error: "Convention not found" });
      }
      return { success: true, message: "Convention deleted successfully" };
    } catch (error) {
      endTimer();
      logger.error('API delete convention endpoint failed', error as Error, { params: request.params });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.delete<{
    Params: { id: string };
  }>("/api/interactions/:id", async (request, reply) => {
    const endTimer = performanceTracker.start('api:delete_interaction');
    try {
      const id = parseInt(request.params.id);
      if (isNaN(id)) {
        endTimer();
        return reply.status(400).send({ success: false, error: "Invalid ID" });
      }
      const deleted = database.deleteInteraction(id);
      endTimer();
      if (!deleted) {
        return reply.status(404).send({ success: false, error: "Interaction not found" });
      }
      return { success: true, message: "Interaction deleted successfully" };
    } catch (error) {
      endTimer();
      logger.error('API delete interaction endpoint failed', error as Error, { params: request.params });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      state?: string;
      priority?: number;
    };
  }>("/api/tasks/:id", async (request, reply) => {
    const endTimer = performanceTracker.start('api:update_task');
    try {
      const id = parseInt(request.params.id);
      if (isNaN(id)) {
        endTimer();
        return reply.status(400).send({
          success: false,
          error: "Invalid ID",
        });
      }

      try {
        database.updateTask(id, request.body);
        endTimer();
        return {
          success: true,
          message: "Task updated successfully"
        };
      } catch (error) {
        endTimer();
        if (error instanceof Error && error.message.includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: "Task not found",
          });
        }
        throw error;
      }
    } catch (error) {
      endTimer();
      logger.error('API update task endpoint failed', error as Error, { params: request.params, body: request.body });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.delete<{
    Params: { id: string };
  }>("/api/tasks/:id", async (request, reply) => {
    const endTimer = performanceTracker.start('api:delete_task');
    try {
      const id = parseInt(request.params.id);
      if (isNaN(id)) {
        endTimer();
        return reply.status(400).send({
          success: false,
          error: "Invalid ID",
        });
      }

      const deleted = database.deleteTask(id);

      if (!deleted) {
        endTimer();
        return reply.status(404).send({
          success: false,
          error: "Task not found",
        });
      }

      endTimer();
      return { success: true, message: "Task deleted successfully" };
    } catch (error) {
      endTimer();
      logger.error('API delete task endpoint failed', error as Error, { params: request.params });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.delete<{
    Params: {
      id: string;
    };
  }>("/api/contexts/:id", async (request, reply) => {
    const endTimer = performanceTracker.start('api:delete_context');
    try {
      const id = parseInt(request.params.id);

      if (isNaN(id)) {
        endTimer();
        return reply.status(400).send({
          success: false,
          error: "Invalid ID",
        });
      }

      const deleted = database.deleteContext(id);

      if (!deleted) {
        endTimer();
        return reply.status(404).send({
          success: false,
          error: "Context not found",
        });
      }

      endTimer();
      return { success: true, message: "Context deleted successfully" };
    } catch (error) {
      endTimer();
      logger.error('API delete context endpoint failed', error as Error, { params: request.params });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get("/api/health", async (_request, reply) => {
    const endTimer = performanceTracker.start('api:health');
    try {
      const stats = database.getStats();
      const schemaVersion = database.getSchemaVersion();
      
      endTimer();
      return {
        success: true,
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        authentication: {
          enabled: authEnabled,
          method: authEnabled ? 'bearer_token' : 'none'
        },
        database: {
          schema_version: schemaVersion,
          tables: {
            session_contexts: stats.sessionContexts.count,
            user_preferences: stats.userPreferences.count,
            project_conventions: stats.projectConventions.count,
            interactions: stats.interactions.count,
            tasks: stats.tasks?.total?.count || 0
          }
        },
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
        }
      };
    } catch (error) {
      endTimer();
      logger.error('Health check failed', error as Error);
      return reply.status(503).send({
        success: false,
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  fastify.get("/api/health/ready", async (_request, reply) => {
    const endTimer = performanceTracker.start('api:health:ready');
    try {
      const schemaVersion = database.getSchemaVersion();
      
      if (schemaVersion < 4) {
        endTimer();
        return reply.status(503).send({
          success: false,
          ready: false,
          reason: `Database schema outdated (v${schemaVersion}, expected v4)`
        });
      }

      endTimer();
      return {
        success: true,
        ready: true,
        schema_version: schemaVersion
      };
    } catch (error) {
      endTimer();
      logger.error('Readiness check failed', error as Error);
      return reply.status(503).send({
        success: false,
        ready: false,
        reason: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  fastify.get("/api/health/live", async () => {
    const endTimer = performanceTracker.start('api:health:live');
    endTimer();
    return {
      success: true,
      alive: true,
      timestamp: new Date().toISOString()
    };
  });

  // ==================== Search & Analytics Endpoints ====================

  fastify.get<{
    Querystring: {
      query: string;
      context_type?: string;
      limit?: string;
    };
  }>("/api/search", async (request, reply) => {
    const endTimer = performanceTracker.start('api:search');
    try {
      const { query, context_type, limit } = request.query;

      if (!query) {
        endTimer();
        return reply.status(400).send({
          success: false,
          error: "query parameter is required",
        });
      }

      const results = database.getAnalytics().searchFullText(query, {
        limit: limit ? parseInt(limit) : 20,
        contextType: context_type,
      });

      endTimer();
      return { success: true, data: results };
    } catch (error) {
      endTimer();
      logger.error('API search endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      min_occurrences?: string;
      context_type?: string;
    };
  }>("/api/patterns", async (request, reply) => {
    const endTimer = performanceTracker.start('api:patterns');
    try {
      const { min_occurrences, context_type } = request.query;

      const patterns = database.getAnalytics().detectPatterns({
        minOccurrences: min_occurrences ? parseInt(min_occurrences) : 3,
        contextType: context_type,
      });

      endTimer();
      return { success: true, data: patterns };
    } catch (error) {
      endTimer();
      logger.error('API patterns endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      period_type?: string;
      start_date?: string;
      end_date?: string;
      context_type?: string;
    };
  }>("/api/temporal", async (request, reply) => {
    const endTimer = performanceTracker.start('api:temporal');
    try {
      const { period_type, start_date, end_date, context_type } = request.query;

      const results = database.getAnalytics().analyzeTemporalPatterns({
        periodType: period_type as any,
        startDate: start_date,
        endDate: end_date,
        contextType: context_type,
      });

      endTimer();
      return { success: true, data: results };
    } catch (error) {
      endTimer();
      logger.error('API temporal endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      context_type?: string;
      project_id?: string;
    };
  }>("/api/conflicts", async (request, reply) => {
    const endTimer = performanceTracker.start('api:conflicts');
    try {
      const { context_type, project_id } = request.query;

      const conflicts = database.getAnalytics().detectConflicts({
        contextType: context_type,
        projectId: project_id,
      });

      endTimer();
      return { success: true, data: conflicts };
    } catch (error) {
      endTimer();
      logger.error('API conflicts endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      project_id?: string;
    };
  }>("/api/memory-map", async (request, reply) => {
    const endTimer = performanceTracker.start('api:memory-map');
    try {
      const { project_id } = request.query;

      const memoryMap = database.getAnalytics().generateMemoryMap({
        projectId: project_id,
      });

      endTimer();
      return { success: true, data: memoryMap };
    } catch (error) {
      endTimer();
      logger.error('API memory-map endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ==================== Task Board & Insights Endpoints ====================

  fastify.get<{
    Querystring: {
      project_id?: string;
      workflow_id?: string;
      group_by?: string;
    };
  }>("/api/task-board", async (request, reply) => {
    const endTimer = performanceTracker.start('api:task-board');
    try {
      const { project_id, workflow_id, group_by } = request.query;

      const taskBoard = database.getTaskBoard({
        projectId: project_id,
        includeDone: false
      });

      endTimer();
      return { success: true, data: taskBoard };
    } catch (error) {
      endTimer();
      logger.error('API task-board endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      project_id?: string;
      days?: string;
    };
  }>("/api/task-insights", async (request, reply) => {
    const endTimer = performanceTracker.start('api:task-insights');
    try {
      const { project_id, days } = request.query;

      const insights = database.getTaskInsights({
        projectId: project_id
      });

      endTimer();
      return { success: true, data: insights };
    } catch (error) {
      endTimer();
      logger.error('API task-insights endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ==================== Project Profile Endpoints ====================

  fastify.get<{
    Querystring: {
      limit?: string;
      language?: string;
    };
  }>("/api/projects", async (request, reply) => {
    const endTimer = performanceTracker.start('api:projects');
    try {
      const { limit, language } = request.query;

      const profiles = database.listProjectProfiles({
        limit: limit ? parseInt(limit) : 50
      });

      endTimer();
      return { success: true, data: profiles };
    } catch (error) {
      endTimer();
      logger.error('API projects endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Params: { id: string };
  }>("/api/projects/:id", async (request, reply) => {
    const endTimer = performanceTracker.start('api:project:get');
    try {
      const { id } = request.params;

      const profile = database.getProjectProfile(id);

      if (!profile) {
        endTimer();
        return reply.status(404).send({
          success: false,
          error: "Project not found",
        });
      }

      endTimer();
      return { success: true, data: profile };
    } catch (error) {
      endTimer();
      logger.error('API project get endpoint failed', error as Error, { params: request.params });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.post<{
    Body: {
      id: string;
      name: string;
      root_path?: string;
      primary_language?: string;
      frameworks?: string[];
      conventions_summary?: string;
    };
  }>("/api/projects", async (request, reply) => {
    const endTimer = performanceTracker.start('api:project:create');
    try {
      const { id, name, root_path, primary_language, frameworks, conventions_summary } = request.body;

      if (!id || !name) {
        endTimer();
        return reply.status(400).send({
          success: false,
          error: "id and name are required",
        });
      }

      const profile = database.createProjectProfile({
        id,
        name,
        root_path,
        primary_language,
        frameworks: frameworks ? frameworks.join(',') : undefined,
        conventions_summary,
      });

      endTimer();
      return { success: true, data: profile };
    } catch (error) {
      endTimer();
      logger.error('API project create endpoint failed', error as Error, { body: request.body });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ==================== Routing Patterns Endpoints ====================

  fastify.get<{
    Querystring: {
      min_confidence?: string;
      limit?: string;
    };
  }>("/api/routing-patterns", async (request, reply) => {
    const endTimer = performanceTracker.start('api:routing-patterns');
    try {
      const { min_confidence, limit } = request.query;

      const patterns = database.getRoutingPatterns(
        min_confidence ? parseFloat(min_confidence) : 0.7,
        limit ? parseInt(limit) : 20
      );

      endTimer();
      return { success: true, data: patterns };
    } catch (error) {
      endTimer();
      logger.error('API routing-patterns endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.post<{
    Body: {
      pattern_key: string;
      agent_name: string;
      confidence?: number;
      file_count?: number;
      loc_estimate?: number;
      metadata?: any;
    };
  }>("/api/routing-patterns", async (request, reply) => {
    const endTimer = performanceTracker.start('api:routing-pattern:create');
    try {
      const { pattern_key, agent_name, confidence, file_count, loc_estimate, metadata } = request.body;

      if (!pattern_key || !agent_name) {
        endTimer();
        return reply.status(400).send({
          success: false,
          error: "pattern_key and agent_name are required",
        });
      }

      database.storeRoutingPattern(
        pattern_key,
        agent_name,
        confidence || 0.7,
        file_count || 0,
        loc_estimate || 0,
        metadata
      );

      endTimer();
      return { success: true, message: `Routing pattern stored: ${pattern_key}` };
    } catch (error) {
      endTimer();
      logger.error('API routing-pattern create endpoint failed', error as Error, { body: request.body });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.get<{
    Querystring: {
      description: string;
      min_confidence?: string;
      limit?: string;
    };
  }>("/api/routing-patterns/similar", async (request, reply) => {
    const endTimer = performanceTracker.start('api:routing-patterns:similar');
    try {
      const { description, min_confidence, limit } = request.query;

      if (!description) {
        endTimer();
        return reply.status(400).send({
          success: false,
          error: "description parameter is required",
        });
      }

      const patterns = database.findSimilarRoutingPatterns(description, {
        minConfidence: min_confidence ? parseFloat(min_confidence) : 0.7,
        limit: limit ? parseInt(limit) : 5,
      });

      endTimer();
      return { success: true, data: patterns };
    } catch (error) {
      endTimer();
      logger.error('API similar routing-patterns endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ==================== Export Endpoint ====================

  fastify.get<{
    Querystring: {
      format?: string;
      context_type?: string;
      limit?: string;
    };
  }>("/api/export", async (request, reply) => {
    const endTimer = performanceTracker.start('api:export');
    try {
      const { format, context_type, limit } = request.query;

      const exported = database.getAnalytics().exportMemories({
        format: format as any,
        contextType: context_type,
        limit: limit ? parseInt(limit) : 1000,
      });

      endTimer();

      if (format === 'markdown') {
        reply.type('text/markdown');
        return exported;
      }

      return { success: true, data: JSON.parse(exported) };
    } catch (error) {
      endTimer();
      logger.error('API export endpoint failed', error as Error, { query: request.query });
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ==================== Database Maintenance Endpoint ====================

  fastify.post("/api/compact", async (_request, reply) => {
    const endTimer = performanceTracker.start('api:compact');
    try {
      const result = database.getAnalytics().compactStorage();
      endTimer();
      return { success: true, data: result };
    } catch (error) {
      endTimer();
      logger.error('API compact endpoint failed', error as Error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  try {
    await fastify.listen({ port, host });
    logger.info(`Dashboard available`, { url: `http://${host}:${port}`, api: `http://${host}:${port}/api/*` });
  } catch (err: any) {
    if (err?.code === "EADDRINUSE") {
      logger.error(`Port ${port} is already in use`, err, { port, host });
    } else {
      logger.error('Failed to start dashboard server', err);
    }
    process.exit(1);
  }

  return fastify;
}
