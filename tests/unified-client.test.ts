import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createRequire } from 'module';
import { promises as fs } from 'fs';
import { 
  SessionMemoryClient,
  SessionMemoryClientFactory,
  DirectDatabaseStrategy 
} from '../src/unified-client';
import { encryptionManager, cacheManager } from '../src/enhanced-infrastructure';

const require = createRequire(import.meta.url);
const BetterSqlite3 = (() => {
  try {
    return require('better-sqlite3');
  } catch {
    return null;
  }
})();

const describeIfBetterSqlite3 = BetterSqlite3 ? describe : describe.skip;

describeIfBetterSqlite3('Session Memory Unified Client', () => {
  let testDb: any;
  let testDbPath: string;
  let client: SessionMemoryClient;

  beforeAll(async () => {
    // Create temporary test database
    testDbPath = `/tmp/test-session-memory-${Date.now()}.db`;
    testDb = new BetterSqlite3(testDbPath);
    
    // Initialize schema
    testDb.exec(`
      CREATE TABLE session_contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        context_type TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, context_type, key)
      );

      CREATE TABLE user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        preference_key TEXT NOT NULL,
        preference_value TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        occurrences INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, preference_key)
      );

      CREATE TABLE project_conventions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        language TEXT NOT NULL,
        convention_type TEXT NOT NULL,
        convention_key TEXT NOT NULL,
        convention_value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, language, convention_type, convention_key)
      );

      CREATE TABLE interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client = SessionMemoryClientFactory.createDirectClient(testDbPath);
  });

  afterAll(async () => {
    await client.close();
    testDb.close();
    await fs.unlink(testDbPath).catch(() => {});
    await cacheManager.clear();
  });

  beforeEach(async () => {
    // Clear test data
    testDb.exec('DELETE FROM session_contexts');
    testDb.exec('DELETE FROM user_preferences');
    testDb.exec('DELETE FROM project_conventions');
    testDb.exec('DELETE FROM interactions');
    await cacheManager.clear();
  });

  describe('Context Management', () => {
    it('should store and retrieve context', async () => {
      const sessionId = 'test-session-1';
      const context = {
        session_id: sessionId,
        context_type: 'workflow',
        key: 'current_step',
        value: JSON.stringify({ step: 'implementation', progress: 0.5 })
      };

      await client.storeContext(context);
      
      const retrieved = await client.getContext(sessionId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].key).toBe('current_step');
      expect(retrieved[0].value).toContain('implementation');
    });

    it('should retrieve specific context by key', async () => {
      const sessionId = 'test-session-2';
      
      await client.storeContext({
        session_id: sessionId,
        context_type: 'workflow',
        key: 'step1',
        value: 'value1'
      });
      
      await client.storeContext({
        session_id: sessionId,
        context_type: 'workflow',
        key: 'step2',
        value: 'value2'
      });

      const retrieved = await client.getContext(sessionId, 'step1');
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].key).toBe('step1');
    });

    it('should handle batch context operations', async () => {
      const sessionId = 'test-session-batch';
      const contexts = [
        {
          session_id: sessionId,
          context_type: 'workflow',
          key: 'step1',
          value: 'value1'
        },
        {
          session_id: sessionId,
          context_type: 'workflow',
          key: 'step2',
          value: 'value2'
        },
        {
          session_id: sessionId,
          context_type: 'workflow',
          key: 'step3',
          value: 'value3'
        }
      ];

      await client.batchStoreContexts(contexts);
      
      const retrieved = await client.getContext(sessionId);
      expect(retrieved).toHaveLength(3);
    });

    it('should encrypt sensitive context data', async () => {
      const sessionId = 'test-session-encrypted';
      const sensitiveContext = {
        session_id: sessionId,
        context_type: 'workflow',
        key: 'api_token',
        value: 'sk-1234567890abcdef'
      };

      await client.storeContext(sensitiveContext);
      
      // Verify data is encrypted in database
      const rawRow = testDb.prepare(`
        SELECT value FROM session_contexts 
        WHERE session_id = ? AND key = ?
      `).get(sessionId, 'api_token') as { value: string };
      
      expect(encryptionManager.isEncrypted(rawRow.value)).toBe(true);
      
      // Verify decrypted retrieval
      const retrieved = await client.getContext(sessionId, 'api_token');
      expect(retrieved[0].value).toBe('sk-1234567890abcdef');
    });
  });

  describe('User Preferences', () => {
    it('should track and retrieve user preferences', async () => {
      const userId = 'test-user';
      const preference = {
        user_id: userId,
        category: 'code_style',
        preference_key: 'string_quotes',
        preference_value: 'single',
        confidence: 0.8
      };

      await client.trackPreference(preference);
      
      const retrieved = await client.getPreferences(userId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].preference_key).toBe('string_quotes');
      expect(retrieved[0].preference_value).toBe('single');
      expect(retrieved[0].confidence).toBe(0.8);
    });

    it('should update existing preferences with confidence weighting', async () => {
      const userId = 'test-user-update';
      const preference1 = {
        user_id: userId,
        category: 'code_style',
        preference_key: 'quotes',
        preference_value: 'single',
        confidence: 0.7
      };

      const preference2 = {
        user_id: userId,
        category: 'code_style',
        preference_key: 'quotes',
        preference_value: 'double',
        confidence: 0.9
      };

      await client.trackPreference(preference1);
      await client.trackPreference(preference2);
      
      const retrieved = await client.getPreferences(userId, 'quotes');
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].preference_value).toBe('double');
      // Confidence should be weighted average
      expect(retrieved[0].confidence).toBeGreaterThan(0.7);
      expect(retrieved[0].confidence).toBeLessThanOrEqual(0.9);
    });

    it('should handle batch preference operations', async () => {
      const userId = 'test-user-batch';
      const preferences = [
        {
          user_id: userId,
          category: 'code_style',
          preference_key: 'quotes',
          preference_value: 'single',
          confidence: 0.8
        },
        {
          user_id: userId,
          category: 'code_style',
          preference_key: 'indentation',
          preference_value: 'spaces',
          confidence: 0.9
        }
      ];

      await client.batchTrackPreferences(preferences);
      
      const retrieved = await client.getPreferences(userId);
      expect(retrieved).toHaveLength(2);
    });
  });

  describe('Project Conventions', () => {
    it('should store and retrieve project conventions', async () => {
      const projectId = 'test-project';
      const convention = {
        project_id: projectId,
        language: 'typescript',
        convention_type: 'testing',
        convention_key: 'test_framework',
        convention_value: 'jest'
      };

      await client.storeConvention(convention);
      
      const retrieved = await client.getConventions(projectId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].language).toBe('typescript');
      expect(retrieved[0].convention_value).toBe('jest');
    });

    it('should filter conventions by language and type', async () => {
      const projectId = 'test-project-filters';
      
      await client.storeConvention({
        project_id: projectId,
        language: 'typescript',
        convention_type: 'testing',
        convention_key: 'framework',
        convention_value: 'jest'
      });
      
      await client.storeConvention({
        project_id: projectId,
        language: 'python',
        convention_type: 'testing',
        convention_key: 'framework',
        convention_value: 'pytest'
      });

      const tsConventions = await client.getConventions(projectId, 'typescript');
      expect(tsConventions).toHaveLength(1);
      expect(tsConventions[0].language).toBe('typescript');

      const testingConventions = await client.getConventions(projectId, undefined, 'testing');
      expect(testingConventions).toHaveLength(2);
    });

    it('should handle batch convention operations', async () => {
      const projectId = 'test-project-batch';
      const conventions = [
        {
          project_id: projectId,
          language: 'typescript',
          convention_type: 'style',
          convention_key: 'quotes',
          convention_value: 'single'
        },
        {
          project_id: projectId,
          language: 'typescript',
          convention_type: 'style',
          convention_key: 'indentation',
          convention_value: 'spaces'
        }
      ];

      await client.batchStoreConventions(conventions);
      
      const retrieved = await client.getConventions(projectId);
      expect(retrieved).toHaveLength(2);
    });
  });

  describe('Interactions', () => {
    it('should store and retrieve interactions', async () => {
      const sessionId = 'test-session-interactions';
      const interaction = {
        session_id: sessionId,
        role: 'assistant',
        content: 'I have completed the task',
        metadata: JSON.stringify({ agent: 'python-coder', duration: 1500 })
      };

      await client.storeInteraction(interaction);
      
      const retrieved = await client.getInteractions(sessionId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].role).toBe('assistant');
      expect(retrieved[0].content).toBe('I have completed the task');
      const parsedMetadata = JSON.parse(retrieved[0].metadata || '{}');
      expect(parsedMetadata.agent).toBe('python-coder');
    });

    it('should limit interaction history', async () => {
      const sessionId = 'test-session-limit';
      
      // Store 10 interactions
      for (let i = 1; i <= 10; i++) {
        await client.storeInteraction({
          session_id: sessionId,
          role: 'assistant',
          content: `Response ${i}`
        });
      }

      const retrieved = await client.getInteractions(sessionId, 5);
      expect(retrieved).toHaveLength(5);
      // Should be most recent first
      expect(retrieved[0].content).toBe('Response 10');
      expect(retrieved[4].content).toBe('Response 6');
    });

    it('should handle batch interaction operations', async () => {
      const sessionId = 'test-session-batch';
      const interactions = [
        {
          session_id: sessionId,
          role: 'user',
          content: 'Request 1'
        },
        {
          session_id: sessionId,
          role: 'assistant',
          content: 'Response 1'
        },
        {
          session_id: sessionId,
          role: 'user',
          content: 'Request 2'
        }
      ];

      await client.batchStoreInteractions(interactions);
      
      const retrieved = await client.getInteractions(sessionId);
      expect(retrieved).toHaveLength(3);
    });
  });

  describe('Caching', () => {
    it('should cache context retrieval results', async () => {
      const sessionId = 'test-session-cache';
      const context = {
        session_id: sessionId,
        context_type: 'workflow',
        key: 'cached_key',
        value: 'cached_value'
      };

      await client.storeContext(context);
      
      // First retrieval should cache
      await client.getContext(sessionId);
      
      // Second retrieval should use cache
      const retrieved = await client.getContext(sessionId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].value).toBe('cached_value');
    });

    it('should invalidate cache on update', async () => {
      const sessionId = 'test-session-invalidate';
      const context = {
        session_id: sessionId,
        context_type: 'workflow',
        key: 'invalidate_key',
        value: 'original_value'
      };

      await client.storeContext(context);
      await client.getContext(sessionId); // Cache it
      
      // Update the value
      await client.storeContext({
        ...context,
        value: 'updated_value'
      });
      
      const retrieved = await client.getContext(sessionId);
      expect(retrieved[0].value).toBe('updated_value');
    });
  });

  describe('Performance', () => {
    it('should handle concurrent operations', async () => {
      const sessionId = 'test-concurrent';
      const promises: Promise<void>[] = [];

      // Create 100 concurrent operations
      for (let i = 0; i < 100; i++) {
        promises.push(
          client.storeContext({
            session_id: sessionId,
            context_type: 'concurrent',
            key: `key_${i}`,
            value: `value_${i}`
          })
        );
      }

      await expect(Promise.all(promises)).resolves.not.toThrow();
      
      const retrieved = await client.getContext(sessionId);
      expect(retrieved).toHaveLength(100);
    });

    it('should batch operations more efficiently than sequential', async () => {
      const sessionId = 'test-performance';
      const itemCount = 50;
      
      // Sequential operations
      const sequentialStart = Date.now();
      for (let i = 0; i < itemCount; i++) {
        await client.storeContext({
          session_id: sessionId + '_seq',
          context_type: 'performance',
          key: `seq_key_${i}`,
          value: `seq_value_${i}`
        });
      }
      const sequentialTime = Date.now() - sequentialStart;
      
      // Batch operations
      const batchStart = Date.now();
      const batchItems = Array.from({ length: itemCount }, (_, i) => ({
        session_id: sessionId + '_batch',
        context_type: 'performance',
        key: `batch_key_${i}`,
        value: `batch_value_${i}`
      }));
      await client.batchStoreContexts(batchItems);
      const batchTime = Date.now() - batchStart;
      
      // Batch should be faster (allow some variance for small test sets)
      expect(batchTime).toBeLessThanOrEqual(sequentialTime * 1.5);
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      const invalidClient = SessionMemoryClientFactory.createDirectClient('/invalid/path/test.db');
      
      await expect(invalidClient.getContext('test')).rejects.toThrow();
      await invalidClient.close();
    });

    it('should validate required fields', async () => {
      await expect(client.storeContext({
        session_id: '',
        context_type: 'workflow',
        key: 'test',
        value: 'value'
      })).rejects.toThrow();
    });

    it('should handle malformed JSON in metadata', async () => {
      const sessionId = 'test-malformed';
      const interaction = {
        session_id: sessionId,
        role: 'assistant',
        content: 'test',
        metadata: '{ invalid json }'
      };

      await expect(client.storeInteraction(interaction)).rejects.toThrow();
    });
  });

  describe('Health and Metrics', () => {
    it('should provide health status', async () => {
      const health = await client.getHealth();
      expect(health.status).toBe('healthy');
      expect(health.metrics).toBeDefined();
    });

    it('should track operation metrics', async () => {
      const sessionId = 'test-metrics';
      
      await client.storeContext({
        session_id: sessionId,
        context_type: 'workflow',
        key: 'metrics_test',
        value: 'test_value'
      });
      
      const health = await client.getHealth();
      expect(health.metrics.storeContext).toBeDefined();
      expect(health.metrics.storeContext.count).toBeGreaterThan(0);
    });
  });
});

describe('Session Memory Client Factory', () => {
  it('should create direct client when dbPath provided', () => {
    const client = SessionMemoryClientFactory.createDirectClient('/tmp/test.db');
    expect(client).toBeInstanceOf(SessionMemoryClient);
  });

  it('should auto-detect client type', () => {
    expect(() => {
      SessionMemoryClientFactory.createAutoClient();
    }).toThrow();
  });
});
