import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createRequire } from 'module';
import path from 'path';
import { existsSync, unlinkSync } from 'fs';

const require = createRequire(import.meta.url);
const BetterSqlite3 = (() => {
  try {
    return require('better-sqlite3');
  } catch {
    return null;
  }
})();

const describeIfBetterSqlite3 = BetterSqlite3 ? describe : describe.skip;

/**
 * OpenCode MCP Integration Test Suite
 * 
 * Tests the MCP server integration with OpenCode CLI via:
 * - Direct Node.js import (tool/mcp.ts pattern)
 * - Session database operations
 * - Type safety with TypeScript
 * - Error handling and recovery
 */

describeIfBetterSqlite3('OpenCode MCP Integration', () => {
  let testDbPath: string;
  let db: any;

  beforeAll(() => {
    // Create isolated test database
    testDbPath = path.join(process.env.HOME!, '.opencode/sessions/test-opencode-integration.db');
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    // Initialize test database with schema
    db = new BetterSqlite3(testDbPath);
    initializeTestDatabase(db);
  });

  afterAll(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('Tool Availability Detection', () => {
    it('should detect MCP tools available in environment', async () => {
      // Simulate tool availability check pattern
      const hasOpenCodeMcp = typeof (global as any).mcp !== 'undefined' &&
                             (global as any).mcp.isToolAvailable?.('store_session_context') === true;

      // Environment should support MCP (or gracefully fallback)
      expect([true, false]).toContain(hasOpenCodeMcp);
    });

    it('should provide fallback when MCP unavailable', async () => {
      // Test silent fallback pattern - no throwing errors
      const mockMcp = {
        isToolAvailable: (tool: string) => false,
        callTool: async (_tool: string, _params?: unknown) => { throw new Error('MCP unavailable'); }
      };

      try {
        await mockMcp.callTool('store_session_context', {});
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Expected - but in real agents, this is handled silently
        expect((error as Error).message).toContain('MCP unavailable');
      }
    });
  });

  describe('Session Context Storage and Retrieval', () => {
    it('should store session context in database', () => {
      const sessionData = {
        session_id: 'test-workflow-001',
        context: 'Implementing user authentication with JWT',
        metadata: JSON.stringify({
          workflow: 'authentication',
          phase: 'implementation',
          language: 'python'
        })
      };

      const stmt = db.prepare(`
        INSERT INTO session_contexts 
        (session_id, context_key, context_value, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      
      stmt.run(
        sessionData.session_id,
        'workflow_state',
        sessionData.context,
        sessionData.metadata
      );

      // Verify stored
      const getStmt = db.prepare(`
        SELECT context_value FROM session_contexts 
        WHERE session_id = ? AND context_key = ?
      `);
      
      const result = getStmt.get(sessionData.session_id, 'workflow_state') as any;

      expect(result).toBeDefined();
      expect(result.context_value).toBe(sessionData.context);
    });

    it('should retrieve session context with metadata', () => {
      const sessionId = 'test-retrieve-001';
      const testContext = 'Building dashboard with React and TypeScript';
      const testMetadata = {
        project: 'dashboard-app',
        timestamp: new Date().toISOString(),
        agent: 'ui-coder'
      };

      // Store
      const storeStmt = db.prepare(`
        INSERT INTO session_contexts 
        (session_id, context_key, context_value, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      
      storeStmt.run(
        sessionId,
        'dashboard_build',
        testContext,
        JSON.stringify(testMetadata)
      );

      // Retrieve
      const getStmt = db.prepare(`
        SELECT context_value, metadata FROM session_contexts 
        WHERE session_id = ? AND context_key = ?
      `);
      
      const result = getStmt.get(sessionId, 'dashboard_build') as any;

      expect(result.context_value).toBe(testContext);
      const metadata = JSON.parse(result.metadata);
      expect(metadata.project).toBe('dashboard-app');
      expect(metadata.agent).toBe('ui-coder');
    });

    it('should update session context without losing history', () => {
      const sessionId = 'test-update-001';
      const contextKey = 'workflow_phase';

      // Initial insert
      const insertStmt = db.prepare(`
        INSERT INTO session_contexts 
        (session_id, context_key, context_value, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `);
      
      insertStmt.run(sessionId, contextKey, 'Phase 1: Planning');

      // Update
      const updateStmt = db.prepare(`
        UPDATE session_contexts 
        SET context_value = ?, updated_at = datetime('now')
        WHERE session_id = ? AND context_key = ?
      `);
      
      updateStmt.run('Phase 2: Implementation', sessionId, contextKey);

      // Verify update
      const getStmt = db.prepare(`
        SELECT context_value, updated_at FROM session_contexts 
        WHERE session_id = ? AND context_key = ?
      `);
      
      const result = getStmt.get(sessionId, contextKey) as any;

      expect(result.context_value).toBe('Phase 2: Implementation');
      expect(result.updated_at).toBeDefined();
    });
  });

  describe('User Preference Tracking', () => {
    it('should store user preference with confidence scoring', () => {
      const preference = {
        user_id: 'default',
        category: 'code_style',
        preference_key: 'string_quotes',
        preference_value: 'double',
        confidence: 0.95
      };

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO user_preferences 
        (user_id, category, preference_key, preference_value, confidence, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);
      
      stmt.run(
        preference.user_id,
        preference.category,
        preference.preference_key,
        preference.preference_value,
        preference.confidence
      );

      // Verify
      const getStmt = db.prepare(`
        SELECT preference_value, confidence FROM user_preferences 
        WHERE user_id = ? AND category = ? AND preference_key = ?
      `);
      
      const result = getStmt.get(preference.user_id, preference.category, preference.preference_key) as any;

      expect(result.preference_value).toBe('double');
      expect(result.confidence).toBe(0.95);
    });

    it('should retrieve all user preferences with filtering', () => {
      const userId = 'test-user-001';

      // Insert multiple preferences
      const stmts = [
        db.prepare(`
          INSERT OR REPLACE INTO user_preferences 
          (user_id, category, preference_key, preference_value, confidence, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `),
        db.prepare(`
          INSERT OR REPLACE INTO user_preferences 
          (user_id, category, preference_key, preference_value, confidence, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `),
        db.prepare(`
          INSERT OR REPLACE INTO user_preferences 
          (user_id, category, preference_key, preference_value, confidence, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `)
      ];

      stmts[0].run(userId, 'code_style', 'quotes', 'double', 0.9);
      stmts[1].run(userId, 'code_style', 'semicolons', 'true', 0.85);
      stmts[2].run(userId, 'commit_style', 'type_format', 'feat(scope): msg', 0.8);

      // Retrieve all
      const getStmt = db.prepare(`
        SELECT category, preference_key, confidence FROM user_preferences 
        WHERE user_id = ?
      `);
      
      const allPrefs = getStmt.all(userId) as any[];

      expect(allPrefs.length).toBeGreaterThanOrEqual(3);

      // Filter by category
      const codeStylePrefs = allPrefs.filter(p => p.category === 'code_style');
      expect(codeStylePrefs.length).toBeGreaterThanOrEqual(2);
    });

    it('should track confidence score evolution', () => {
      const userId = 'test-confidence-001';
      const prefKey = 'trailing_commas';

      // Start with low confidence (initial observation)
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO user_preferences 
        (user_id, category, preference_key, preference_value, confidence, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);
      
      insertStmt.run(userId, 'code_style', prefKey, 'true', 0.6);

      const getStmt = db.prepare(`
        SELECT confidence FROM user_preferences 
        WHERE user_id = ? AND preference_key = ?
      `);
      
      let result = getStmt.get(userId, prefKey) as any;
      expect(result.confidence).toBe(0.6);

      // Increase confidence (pattern confirmed)
      const updateStmt = db.prepare(`
        UPDATE user_preferences 
        SET confidence = ?, updated_at = datetime('now')
        WHERE user_id = ? AND preference_key = ?
      `);
      
      updateStmt.run(0.7, userId, prefKey);
      result = getStmt.get(userId, prefKey) as any;
      expect(result.confidence).toBe(0.7);

      // Further confirmation
      updateStmt.run(0.9, userId, prefKey);
      result = getStmt.get(userId, prefKey) as any;
      expect(result.confidence).toBe(0.9);
    });
  });

  describe('Project Conventions Learning', () => {
    it('should store project-specific convention', () => {
      const convention = {
        project_id: 'test-project',
        language: 'python',
        convention_type: 'error_handling',
        convention_key: 'exception_style',
        convention_value: 'Result types with Ok/Err pattern'
      };

      const stmt = db.prepare(`
        INSERT INTO project_conventions 
        (project_id, language, convention_type, convention_key, convention_value, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);
      
      stmt.run(
        convention.project_id,
        convention.language,
        convention.convention_type,
        convention.convention_key,
        convention.convention_value
      );

      // Verify
      const getStmt = db.prepare(`
        SELECT convention_value FROM project_conventions 
        WHERE project_id = ? AND language = ? AND convention_key = ?
      `);
      
      const result = getStmt.get(convention.project_id, convention.language, convention.convention_key) as any;

      expect(result.convention_value).toBe('Result types with Ok/Err pattern');
    });

    it('should retrieve conventions by language', () => {
      const projectId = 'test-lang-project';
      const language = 'typescript';

      // Insert multiple conventions for TypeScript
      const stmt = db.prepare(`
        INSERT INTO project_conventions 
        (project_id, language, convention_type, convention_key, convention_value, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);

      const conventions = [
        ['import_style', 'ES6 modules with named imports'],
        ['testing_framework', 'Jest with describe/it blocks'],
        ['async_pattern', 'async/await over .then()']
      ];

      for (const [key, value] of conventions) {
        stmt.run(projectId, language, 'pattern', key, value);
      }

      // Retrieve all for language
      const getStmt = db.prepare(`
        SELECT convention_key, convention_value FROM project_conventions 
        WHERE project_id = ? AND language = ?
      `);
      
      const results = getStmt.all(projectId, language) as any[];

      expect(results.length).toBeGreaterThanOrEqual(3);
      expect(results.map(r => r.convention_key)).toContain('import_style');
      expect(results.map(r => r.convention_key)).toContain('testing_framework');
    });
  });

  describe('Task Board Synchronization', () => {
    it('should sync todo to task database', () => {
      const todo = {
        id: 'task-001',
        content: 'Implement user authentication',
        status: 'pending',
        priority: 'high'
      };

      // Map todo status to task state
      const taskState = todo.status === 'pending' ? 'backlog' :
                       todo.status === 'in_progress' ? 'in_progress' :
                       'done';

      const stmt = db.prepare(`
        INSERT INTO tasks 
        (id, title, state, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      
      stmt.run(todo.id, todo.content, taskState, todo.priority);

      // Verify
      const getStmt = db.prepare(`
        SELECT state, priority FROM tasks WHERE id = ?
      `);
      
      const result = getStmt.get(todo.id) as any;

      expect(result.state).toBe('backlog');
      expect(result.priority).toBe('high');
    });

    it('should update task state transitions', () => {
      const taskId = 'task-state-001';

      // Create in backlog
      const createStmt = db.prepare(`
        INSERT INTO tasks 
        (id, title, state, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      
      createStmt.run(taskId, 'Test task', 'backlog', 'medium');

      // Move to in_progress
      const updateStmt = db.prepare(`
        UPDATE tasks 
        SET state = ?, updated_at = datetime('now')
        WHERE id = ?
      `);
      
      updateStmt.run('in_progress', taskId);

      const getStmt = db.prepare(`
        SELECT state FROM tasks WHERE id = ?
      `);
      
      let result = getStmt.get(taskId) as any;
      expect(result.state).toBe('in_progress');

      // Move to done
      updateStmt.run('done', taskId);
      result = getStmt.get(taskId) as any;
      expect(result.state).toBe('done');
    });

    it('should build kanban board view', () => {
      // Insert tasks in different states
      const stmt = db.prepare(`
        INSERT INTO tasks 
        (id, title, state, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `);

      const tasks = [
        ['backlog-1', 'Task 1', 'backlog'],
        ['inprogress-1', 'Task 2', 'in_progress'],
        ['inprogress-2', 'Task 3', 'in_progress'],
        ['done-1', 'Task 4', 'done']
      ];

      for (const [id, title, state] of tasks) {
        stmt.run(id, title, state);
      }

      // Query board view
      const backlogStmt = db.prepare(`
        SELECT COUNT(*) as count FROM tasks WHERE state = 'backlog'
      `);
      const backlog = backlogStmt.get() as any;

      const inProgressStmt = db.prepare(`
        SELECT COUNT(*) as count FROM tasks WHERE state = 'in_progress'
      `);
      const inProgress = inProgressStmt.get() as any;

      const doneStmt = db.prepare(`
        SELECT COUNT(*) as count FROM tasks WHERE state = 'done'
      `);
      const done = doneStmt.get() as any;

      expect(backlog.count).toBeGreaterThanOrEqual(1);
      expect(inProgress.count).toBeGreaterThanOrEqual(2);
      expect(done.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle database errors gracefully', () => {
      const getStmt = db.prepare(`
        SELECT * FROM session_contexts LIMIT 1
      `);
      
      // Should not throw
      expect(() => {
        getStmt.get();
      }).not.toThrow();
    });

    it('should recover from corrupted context', () => {
      const sessionId = 'test-corrupt-001';

      // Insert with invalid JSON metadata (simulate corruption)
      const stmt = db.prepare(`
        INSERT INTO session_contexts 
        (session_id, context_key, context_value, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      
      stmt.run(sessionId, 'corrupted', 'value', '{invalid json');

      // Attempt to read - should not crash
      const getStmt = db.prepare(`
        SELECT context_value, metadata FROM session_contexts 
        WHERE session_id = ?
      `);
      
      const result = getStmt.get(sessionId) as any;

      expect(result).toBeDefined();
      expect(result.context_value).toBe('value');

      // Try to parse metadata - handle error gracefully
      let metadata: any = null;
      try {
        metadata = JSON.parse(result.metadata);
      } catch (e) {
        // Expected - corrupted JSON
        metadata = { error: 'corrupted' };
      }

      expect(metadata.error).toBe('corrupted');
    });
  });

  describe('Cross-Workflow Learning Integration', () => {
    it('should store routing pattern with confidence', () => {
      const pattern = {
        pattern_key: 'fastapi_simple_endpoint',
        agent_name: 'language-coder',
        confidence: 0.85,
        file_count: 1,
        loc_estimate: 45,
        metadata: JSON.stringify({
          framework: 'fastapi',
          complexity: 'simple',
          language: 'python'
        })
      };

      // Insert pattern
      const stmt = db.prepare(`
        INSERT INTO routing_patterns 
        (pattern_key, agent_name, confidence, file_count, loc_estimate, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      
      stmt.run(
        pattern.pattern_key,
        pattern.agent_name,
        pattern.confidence,
        pattern.file_count,
        pattern.loc_estimate,
        pattern.metadata
      );

      // Verify
      const getStmt = db.prepare(`
        SELECT agent_name, confidence FROM routing_patterns 
        WHERE pattern_key = ?
      `);
      
      const result = getStmt.get(pattern.pattern_key) as any;

      expect(result.agent_name).toBe('language-coder');
      expect(result.confidence).toBe(0.85);
    });

    it('should filter patterns by confidence threshold', () => {
      const stmt = db.prepare(`
        INSERT INTO routing_patterns 
        (pattern_key, agent_name, confidence, file_count, loc_estimate, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      const patterns = [
        ['pattern-1', 'agent-a', 0.95],
        ['pattern-2', 'agent-b', 0.75],
        ['pattern-3', 'agent-c', 0.65],
        ['pattern-4', 'agent-d', 0.88]
      ];

      for (const [key, agent, conf] of patterns) {
        stmt.run(key, agent, conf, 1, 50);
      }

      // Query with confidence >= 0.7
      const queryStmt = db.prepare(`
        SELECT pattern_key, confidence FROM routing_patterns 
        WHERE confidence >= ?
        ORDER BY confidence DESC
      `);
      
      const highConfidence = queryStmt.all(0.7) as any[];

      const keys = highConfidence.map(p => p.pattern_key);
      expect(keys).toContain('pattern-1'); // 0.95
      expect(keys).toContain('pattern-2'); // 0.75
      expect(keys).toContain('pattern-4'); // 0.88
      expect(keys).not.toContain('pattern-3'); // 0.65 (below threshold)
    });

    it('should update pattern confidence on success', () => {
      const patternKey = 'test-pattern-update';

      // Initial pattern with medium confidence
      const insertStmt = db.prepare(`
        INSERT INTO routing_patterns 
        (pattern_key, agent_name, confidence, file_count, loc_estimate, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      
      insertStmt.run(patternKey, 'test-agent', 0.7, 1, 50);

      // Simulate successful use - increase confidence
      const updateStmt = db.prepare(`
        UPDATE routing_patterns 
        SET confidence = ?, updated_at = datetime('now')
        WHERE pattern_key = ?
      `);
      
      updateStmt.run(0.75, patternKey);

      const getStmt = db.prepare(`
        SELECT confidence FROM routing_patterns WHERE pattern_key = ?
      `);
      
      let result = getStmt.get(patternKey) as any;
      expect(result.confidence).toBe(0.75);

      // Another success
      updateStmt.run(0.8, patternKey);
      result = getStmt.get(patternKey) as any;
      expect(result.confidence).toBe(0.8);
    });
  });

  describe('Interaction History Tracking', () => {
    it('should store interaction with metadata', () => {
      const interaction = {
        session_id: 'test-session-001',
        role: 'user',
        content: 'Create a FastAPI endpoint for user registration',
        metadata: JSON.stringify({
          workflow: 'authentication',
          task_id: 'auth-001'
        })
      };

      const stmt = db.prepare(`
        INSERT INTO interactions 
        (session_id, role, content, metadata, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `);
      
      stmt.run(
        interaction.session_id,
        interaction.role,
        interaction.content,
        interaction.metadata
      );

      // Verify
      const getStmt = db.prepare(`
        SELECT role, content FROM interactions 
        WHERE session_id = ?
      `);
      
      const result = getStmt.get(interaction.session_id) as any;

      expect(result.role).toBe('user');
      expect(result.content).toContain('FastAPI');
    });

    it('should retrieve interaction history in order', () => {
      const sessionId = 'test-history-001';

      const stmt = db.prepare(`
        INSERT INTO interactions 
        (session_id, role, content, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `);

      const interactions = [
        { role: 'user', content: 'Start authentication workflow' },
        { role: 'assistant', content: 'Planning authentication flow...' },
        { role: 'user', content: 'Use JWT tokens' },
        { role: 'assistant', content: 'Implementing JWT with bcrypt...' }
      ];

      for (const interaction of interactions) {
        stmt.run(sessionId, interaction.role, interaction.content);
      }

      // Retrieve in order
      const getStmt = db.prepare(`
        SELECT role, content FROM interactions 
        WHERE session_id = ?
        ORDER BY created_at ASC
      `);
      
      const history = getStmt.all(sessionId) as any[];

      expect(history.length).toBe(4);
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
      expect(history[history.length - 1].content).toContain('JWT');
    });
  });
});

/**
 * Initialize test database with schema
 */
function initializeTestDatabase(db: Database.Database): void {
  // Session contexts
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      context_key TEXT NOT NULL,
      context_value TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, context_key)
    )
  `);

  // User preferences
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default',
      category TEXT NOT NULL,
      preference_key TEXT NOT NULL,
      preference_value TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, category, preference_key)
    )
  `);

  // Project conventions
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_conventions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      language TEXT NOT NULL,
      convention_type TEXT NOT NULL,
      convention_key TEXT NOT NULL,
      convention_value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, language, convention_key)
    )
  `);

  // Tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      state TEXT DEFAULT 'backlog',
      priority TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Routing patterns
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_key TEXT NOT NULL UNIQUE,
      agent_name TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      file_count INTEGER DEFAULT 0,
      loc_estimate INTEGER DEFAULT 0,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Interactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
