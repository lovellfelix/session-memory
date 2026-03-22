import { logger } from './logger.js';
import { performanceTracker } from './performance.js';
import { ValidationError } from './errors.js';

/**
 * Memory entry for analysis
 */
export interface MemoryEntry {
  id: number;
  content: string;
  type: string;
  tags?: string[];
  project_id?: string;
  created_at: string;
  updated_at: string;
  metadata?: any;
}

/**
 * Conflict detection result
 */
export interface ConflictResult {
  entry1: { id: number; key: string; value: string; updated_at: string };
  entry2: { id: number; key: string; value: string; updated_at: string };
  conflictType: 'value_mismatch' | 'outdated' | 'duplicate_key';
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

/**
 * Temporal analysis result
 */
export interface TemporalResult {
  period: string;
  count: number;
  types: Record<string, number>;
  peakHour?: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

/**
 * Pattern detection result
 */
export interface PatternResult {
  pattern: string;
  occurrences: number;
  confidence: number;
  examples: string[];
  category: string;
}

/**
 * Search result with relevance score
 */
export interface SearchResult {
  id: number;
  content: string;
  type: string;
  score: number;
  highlights?: string[];
  metadata?: any;
}

/**
 * Analytics and search engine for session-memory
 * Provides semantic search, conflict detection, temporal analysis, and pattern detection
 */
export class AnalyticsEngine {
  private db: any; // sql.js database type
  private embeddingModel: any = null;
  private embeddingsEnabled: boolean = false;

  constructor(db: any) {
    this.db = db;
    this.initializeAnalyticsTables();
    if (process.env.ENABLE_SEMANTIC_SEARCH === 'true') {
      this.tryLoadEmbeddings();
    } else {
      this.embeddingsEnabled = false;
    }
  }

  /**
   * Helper to execute a query and return all rows with sql.js
   */
  private queryAll(sql: string, params: any[] = []): any[] {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    
    const results: any[] = [];
    const columns = stmt.getColumnNames();
    
    while (stmt.step()) {
      const values = stmt.get();
      const row: any = {};
      columns.forEach((col: string, idx: number) => {
        row[col] = values[idx];
      });
      results.push(row);
    }
    
    stmt.free();
    return results;
  }

  /**
   * Helper to execute a query and return a single row with sql.js
   */
  private queryGet(sql: string, params: any[] = []): any | undefined {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    
    let result: any | undefined;
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      result = {};
      columns.forEach((col: string, idx: number) => {
        result[col] = values[idx];
      });
    }
    
    stmt.free();
    return result;
  }

  private initializeAnalyticsTables(): void {
    // Memory tags table for tag-based queries
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        memory_type TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(memory_id, memory_type, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);
      CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id, memory_type);
    `);

    // Embeddings table for semantic search (optional)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        memory_type TEXT NOT NULL,
        embedding BLOB,
        model_version TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(memory_id, memory_type)
      );
    `);

    // Analytics cache for expensive computations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_cache (
        cache_key TEXT PRIMARY KEY,
        cache_value TEXT NOT NULL,
        computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      );
    `);
  }

  private async tryLoadEmbeddings(): Promise<void> {
    try {
      // Try to dynamically import transformers if available
      // @ts-ignore - Optional dependency, may not be installed
      const transformers = await import('@xenova/transformers');
      this.embeddingModel = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      this.embeddingsEnabled = true;
      logger.info('Semantic search enabled with transformers');
    } catch (error) {
      logger.info('Semantic search disabled (transformers not installed)');
      this.embeddingsEnabled = false;
    }
  }

  /**
   * Full-text search using FTS5 with BM25 ranking
   */
  searchFullText(
    query: string,
    options: {
      limit?: number;
      contextType?: string;
      projectId?: string;
    } = {}
  ): SearchResult[] {
    const end = performanceTracker.start('analytics:fulltext_search');
    
    try {
      const { limit = 20, contextType, projectId } = options;

      // Use FTS5 for full-text search
      let sql = `
        SELECT 
          sc.id,
          sc.value as content,
          sc.context_type as type,
          bm25(session_contexts_fts) as score,
          sc.metadata,
          snippet(session_contexts_fts, 3, '<mark>', '</mark>', '...', 32) as highlights
        FROM session_contexts_fts
        JOIN session_contexts sc ON session_contexts_fts.rowid = sc.id
        WHERE session_contexts_fts MATCH ?
      `;

      const params: any[] = [query];

      if (contextType) {
        sql += ` AND sc.context_type = ?`;
        params.push(contextType);
      }

      sql += ` ORDER BY bm25(session_contexts_fts) LIMIT ?`;
      params.push(limit);

      // Execute query with sql.js
      const stmt = this.db.prepare(sql);
      stmt.bind(params);
      
      const results: any[] = [];
      const columns = stmt.getColumnNames();
      
      while (stmt.step()) {
        const values = stmt.get();
        const row: any = {};
        columns.forEach((col: string, idx: number) => {
          row[col] = values[idx];
        });
        results.push(row);
      }
      
      stmt.free();

      end();
      return results.map(r => ({
        id: r.id,
        content: r.content,
        type: r.type,
        score: Math.abs(r.score), // BM25 returns negative scores
        highlights: r.highlights ? [r.highlights] : undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    } catch (error) {
      end();
      logger.warn('Full-text search failed, falling back to LIKE', { error });
      return this.searchFallback(query, options);
    }
  }

  private searchFallback(
    query: string,
    options: { limit?: number; contextType?: string } = {}
  ): SearchResult[] {
    const { limit = 20, contextType } = options;
    
    let sql = `
      SELECT id, value as content, context_type as type, metadata
      FROM session_contexts
      WHERE value LIKE ?
    `;
    const params: any[] = [`%${query}%`];

    if (contextType) {
      sql += ` AND context_type = ?`;
      params.push(contextType);
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    // Execute query with sql.js
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    
    const results: any[] = [];
    const columns = stmt.getColumnNames();
    
    while (stmt.step()) {
      const values = stmt.get();
      const row: any = {};
      columns.forEach((col: string, idx: number) => {
        row[col] = values[idx];
      });
      results.push(row);
    }
    
    stmt.free();

    return results.map(r => ({
      id: r.id,
      content: r.content,
      type: r.type,
      score: 1.0,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  /**
   * Semantic similarity search using embeddings
   */
  async searchSemantic(
    query: string,
    options: { limit?: number; threshold?: number } = {}
  ): Promise<SearchResult[]> {
    if (!this.embeddingsEnabled || !this.embeddingModel) {
      logger.warn('Semantic search not available, using full-text search');
      return this.searchFullText(query, options);
    }

    const end = performanceTracker.start('analytics:semantic_search');
    
    try {
      const { limit = 10, threshold = 0.5 } = options;

      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);

      // Get all stored embeddings (in production, use vector DB like Milvus)
      const sql = `
        SELECT me.memory_id, me.embedding, sc.value, sc.context_type, sc.metadata
        FROM memory_embeddings me
        JOIN session_contexts sc ON me.memory_id = sc.id AND me.memory_type = 'session_context'
      `;
      
      const stmt = this.db.prepare(sql);
      const stored: any[] = [];
      const columns = stmt.getColumnNames();
      
      while (stmt.step()) {
        const values = stmt.get();
        const row: any = {};
        columns.forEach((col: string, idx: number) => {
          row[col] = values[idx];
        });
        stored.push(row);
      }
      
      stmt.free();

      // Calculate cosine similarity
      const results = stored
        .map(row => {
          const storedEmbedding = JSON.parse(row.embedding);
          const similarity = this.cosineSimilarity(queryEmbedding, storedEmbedding);
          return {
            id: row.memory_id,
            content: row.value,
            type: row.context_type,
            score: similarity,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          };
        })
        .filter(r => r.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      end();
      return results;
    } catch (error) {
      end();
      logger.error('Semantic search failed', error as Error);
      return this.searchFullText(query, options);
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model not loaded');
    }
    const output = await this.embeddingModel(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Detect conflicts between memory entries
   */
  detectConflicts(options: {
    projectId?: string;
    contextType?: string;
    threshold?: number;
  } = {}): ConflictResult[] {
    const end = performanceTracker.start('analytics:detect_conflicts');
    
    try {
      const conflicts: ConflictResult[] = [];
      const { projectId, contextType, threshold = 0.8 } = options;

      // Find duplicate keys with different values
      let sql = `
        SELECT 
          a.id as id1, a.key as key1, a.value as value1, a.updated_at as updated1,
          b.id as id2, b.key as key2, b.value as value2, b.updated_at as updated2
        FROM session_contexts a
        JOIN session_contexts b ON a.key = b.key AND a.id < b.id
        WHERE a.value != b.value
      `;

      if (contextType) {
        sql += ` AND a.context_type = ? AND b.context_type = ?`;
      }

      sql += ` LIMIT 100`;

      const params = contextType ? [contextType, contextType] : [];
      const duplicates = this.queryAll(sql, params);

      for (const dup of duplicates) {
        const timeDiff = new Date(dup.updated2).getTime() - new Date(dup.updated1).getTime();
        const isRecent = Math.abs(timeDiff) < 24 * 60 * 60 * 1000; // 24 hours

        conflicts.push({
          entry1: { id: dup.id1, key: dup.key1, value: dup.value1, updated_at: dup.updated1 },
          entry2: { id: dup.id2, key: dup.key2, value: dup.value2, updated_at: dup.updated2 },
          conflictType: isRecent ? 'value_mismatch' : 'outdated',
          severity: isRecent ? 'high' : 'medium',
          suggestion: isRecent 
            ? 'Values conflict for the same key. Review and consolidate.'
            : `Entry from ${dup.updated1} may be outdated. Consider removing.`,
        });
      }

      // Find preference conflicts
      const prefConflicts = this.queryAll(`
        SELECT 
          a.id as id1, a.preference_key as key1, a.preference_value as value1, a.updated_at as updated1,
          b.id as id2, b.preference_key as key2, b.preference_value as value2, b.updated_at as updated2
        FROM user_preferences a
        JOIN user_preferences b ON a.preference_key = b.preference_key 
          AND a.user_id = b.user_id 
          AND a.id < b.id
        WHERE a.preference_value != b.preference_value
        LIMIT 50
      `);

      for (const pref of prefConflicts) {
        conflicts.push({
          entry1: { id: pref.id1, key: pref.key1, value: pref.value1, updated_at: pref.updated1 },
          entry2: { id: pref.id2, key: pref.key2, value: pref.value2, updated_at: pref.updated2 },
          conflictType: 'duplicate_key',
          severity: 'low',
          suggestion: 'Duplicate preference entries. The newer value should be used.',
        });
      }

      end();
      return conflicts;
    } catch (error) {
      end();
      logger.error('Conflict detection failed', error as Error);
      return [];
    }
  }

  /**
   * Analyze memory patterns over time
   */
  analyzeTemporalPatterns(options: {
    periodType?: 'hour' | 'day' | 'week' | 'month';
    startDate?: string;
    endDate?: string;
    contextType?: string;
  } = {}): TemporalResult[] {
    const end = performanceTracker.start('analytics:temporal_analysis');
    
    try {
      const { periodType = 'day', startDate, endDate, contextType } = options;

      let dateFormat: string;
      switch (periodType) {
        case 'hour': dateFormat = '%Y-%m-%d %H:00'; break;
        case 'week': dateFormat = '%Y-W%W'; break;
        case 'month': dateFormat = '%Y-%m'; break;
        default: dateFormat = '%Y-%m-%d';
      }

      let sql = `
        SELECT 
          strftime('${dateFormat}', created_at) as period,
          COUNT(*) as count,
          context_type,
          strftime('%H', created_at) as hour
        FROM session_contexts
        WHERE 1=1
      `;

      const params: any[] = [];

      if (startDate) {
        sql += ` AND created_at >= ?`;
        params.push(startDate);
      }

      if (endDate) {
        sql += ` AND created_at <= ?`;
        params.push(endDate);
      }

      if (contextType) {
        sql += ` AND context_type = ?`;
        params.push(contextType);
      }

      sql += ` GROUP BY period, context_type ORDER BY period DESC`;

      const rawResults = this.queryAll(sql, params);

      // Aggregate by period
      const periodMap = new Map<string, { count: number; types: Record<string, number>; hours: number[] }>();

      for (const row of rawResults) {
        if (!periodMap.has(row.period)) {
          periodMap.set(row.period, { count: 0, types: {}, hours: [] });
        }
        const period = periodMap.get(row.period)!;
        period.count += row.count;
        period.types[row.context_type] = (period.types[row.context_type] || 0) + row.count;
        if (row.hour) period.hours.push(parseInt(row.hour));
      }

      // Calculate trends
      const results: TemporalResult[] = [];
      const periods = Array.from(periodMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      for (let i = 0; i < periods.length; i++) {
        const [period, data] = periods[i];
        
        let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
        if (i > 0) {
          const prevCount = periods[i - 1][1].count;
          const change = (data.count - prevCount) / prevCount;
          if (change > 0.1) trend = 'increasing';
          else if (change < -0.1) trend = 'decreasing';
        }

        // Calculate peak hour
        const hourCounts = new Map<number, number>();
        for (const h of data.hours) {
          hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
        }
        let peakHour: number | undefined;
        let maxHourCount = 0;
        for (const [hour, count] of hourCounts) {
          if (count > maxHourCount) {
            maxHourCount = count;
            peakHour = hour;
          }
        }

        results.push({
          period,
          count: data.count,
          types: data.types,
          peakHour,
          trend,
        });
      }

      end();
      return results;
    } catch (error) {
      end();
      logger.error('Temporal analysis failed', error as Error);
      return [];
    }
  }

  /**
   * Detect recurring patterns in memory content
   */
  detectPatterns(options: {
    minOccurrences?: number;
    contextType?: string;
    patternTypes?: string[];
  } = {}): PatternResult[] {
    const end = performanceTracker.start('analytics:pattern_detection');
    
    try {
      const { minOccurrences = 3, contextType, patternTypes = ['key', 'value', 'convention'] } = options;
      const patterns: PatternResult[] = [];

      // Detect key patterns
      if (patternTypes.includes('key')) {
        let sql = `
          SELECT key, COUNT(*) as count
          FROM session_contexts
          WHERE 1=1
        `;
        if (contextType) sql += ` AND context_type = ?`;
        sql += ` GROUP BY key HAVING count >= ? ORDER BY count DESC LIMIT 50`;

        const params = contextType ? [contextType, minOccurrences] : [minOccurrences];
        const keyPatterns = this.queryAll(sql, params);

        for (const kp of keyPatterns) {
          patterns.push({
            pattern: kp.key,
            occurrences: kp.count,
            confidence: Math.min(kp.count / 10, 1.0),
            examples: [],
            category: 'key_pattern',
          });
        }
      }

      // Detect convention patterns
      if (patternTypes.includes('convention')) {
        const conventionPatterns = this.db.prepare(`
          SELECT convention_type, convention_key, COUNT(*) as count
          FROM project_conventions
          GROUP BY convention_type, convention_key
          HAVING count >= ?
          ORDER BY count DESC
          LIMIT 50
        `).all(minOccurrences) as any[];

        for (const cp of conventionPatterns) {
          patterns.push({
            pattern: `${cp.convention_type}:${cp.convention_key}`,
            occurrences: cp.count,
            confidence: Math.min(cp.count / 5, 1.0),
            examples: [],
            category: 'convention_pattern',
          });
        }
      }

      // Detect preference patterns
      const preferencePatterns = this.db.prepare(`
        SELECT category, preference_key, preference_value, COUNT(*) as count, AVG(confidence) as avg_confidence
        FROM user_preferences
        GROUP BY category, preference_key, preference_value
        HAVING count >= ?
        ORDER BY avg_confidence DESC, count DESC
        LIMIT 50
      `).all(minOccurrences) as any[];

      for (const pp of preferencePatterns) {
        patterns.push({
          pattern: `${pp.category}:${pp.preference_key}=${pp.preference_value}`,
          occurrences: pp.count,
          confidence: pp.avg_confidence,
          examples: [],
          category: 'preference_pattern',
        });
      }

      end();
      return patterns;
    } catch (error) {
      end();
      logger.error('Pattern detection failed', error as Error);
      return [];
    }
  }

  /**
   * Generate memory map/visualization data
   */
  generateMemoryMap(options: {
    projectId?: string;
    depth?: number;
  } = {}): any {
    const end = performanceTracker.start('analytics:memory_map');
    
    try {
      const stats = {
        totalContexts: 0,
        totalPreferences: 0,
        totalConventions: 0,
        totalInteractions: 0,
        totalTasks: 0,
        byContextType: {} as Record<string, number>,
        byProject: {} as Record<string, number>,
        byLanguage: {} as Record<string, number>,
        recentActivity: [] as any[],
      };

      // Get counts
      stats.totalContexts = (this.queryGet('SELECT COUNT(*) as c FROM session_contexts') as any).c;
      stats.totalPreferences = (this.queryGet('SELECT COUNT(*) as c FROM user_preferences') as any).c;
      stats.totalConventions = (this.queryGet('SELECT COUNT(*) as c FROM project_conventions') as any).c;
      stats.totalInteractions = (this.queryGet('SELECT COUNT(*) as c FROM interactions') as any).c;
      stats.totalTasks = (this.queryGet('SELECT COUNT(*) as c FROM tasks') as any).c;

      // By context type
      const contextTypes = this.db.prepare(`
        SELECT context_type, COUNT(*) as count
        FROM session_contexts
        GROUP BY context_type
      `).all() as any[];
      for (const ct of contextTypes) {
        stats.byContextType[ct.context_type] = ct.count;
      }

      // By project
      const projects = this.db.prepare(`
        SELECT project_id, COUNT(*) as count
        FROM project_conventions
        GROUP BY project_id
      `).all() as any[];
      for (const p of projects) {
        stats.byProject[p.project_id] = p.count;
      }

      // By language
      const languages = this.db.prepare(`
        SELECT language, COUNT(*) as count
        FROM project_conventions
        GROUP BY language
      `).all() as any[];
      for (const l of languages) {
        stats.byLanguage[l.language] = l.count;
      }

      // Recent activity
      stats.recentActivity = this.db.prepare(`
        SELECT 'context' as type, key as name, updated_at as timestamp
        FROM session_contexts
        UNION ALL
        SELECT 'preference' as type, preference_key as name, updated_at as timestamp
        FROM user_preferences
        ORDER BY timestamp DESC
        LIMIT 20
      `).all() as any[];

      end();
      return stats;
    } catch (error) {
      end();
      logger.error('Memory map generation failed', error as Error);
      return {};
    }
  }

  /**
   * Export memories in various formats
   */
  exportMemories(options: {
    format?: 'json' | 'markdown';
    contextType?: string;
    projectId?: string;
    limit?: number;
  } = {}): string {
    const end = performanceTracker.start('analytics:export');
    
    try {
      const { format = 'json', contextType, projectId, limit = 1000 } = options;

      let sql = 'SELECT * FROM session_contexts WHERE 1=1';
      const params: any[] = [];

      if (contextType) {
        sql += ' AND context_type = ?';
        params.push(contextType);
      }

      sql += ' ORDER BY updated_at DESC LIMIT ?';
      params.push(limit);

      const contexts = this.queryAll(sql, params);

      if (format === 'markdown') {
        let md = '# Session Memory Export\n\n';
        md += `Exported: ${new Date().toISOString()}\n\n`;
        md += `Total entries: ${contexts.length}\n\n`;

        for (const ctx of contexts) {
          md += `## ${ctx.key}\n`;
          md += `- **Type**: ${ctx.context_type}\n`;
          md += `- **Session**: ${ctx.session_id}\n`;
          md += `- **Updated**: ${ctx.updated_at}\n\n`;
          md += `\`\`\`\n${ctx.value}\n\`\`\`\n\n`;
        }

        end();
        return md;
      }

      end();
      return JSON.stringify(contexts, null, 2);
    } catch (error) {
      end();
      logger.error('Export failed', error as Error);
      return options.format === 'json' ? '[]' : '# Export failed';
    }
  }

  /**
   * Import memories from JSON
   */
  importMemories(data: string, options: {
    overwrite?: boolean;
    sessionId?: string;
  } = {}): { imported: number; skipped: number; errors: number } {
    const end = performanceTracker.start('analytics:import');
    const result = { imported: 0, skipped: 0, errors: 0 };

    try {
      const { overwrite = false, sessionId } = options;
      const memories = JSON.parse(data);

      if (!Array.isArray(memories)) {
        throw new ValidationError('Import data must be an array');
      }

      for (const memory of memories) {
        try {
          if (!memory.key || !memory.value || !memory.context_type) {
            result.skipped++;
            continue;
          }

          const existing = this.db.prepare(`
            SELECT id FROM session_contexts
            WHERE session_id = ? AND context_type = ? AND key = ?
          `).get(sessionId || memory.session_id, memory.context_type, memory.key);

          if (existing && !overwrite) {
            result.skipped++;
            continue;
          }

          if (existing && overwrite) {
            this.db.prepare(`
              UPDATE session_contexts
              SET value = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(memory.value, memory.metadata ? JSON.stringify(memory.metadata) : null, (existing as any).id);
          } else {
            this.db.prepare(`
              INSERT INTO session_contexts (session_id, context_type, key, value, metadata)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              sessionId || memory.session_id || 'imported',
              memory.context_type,
              memory.key,
              memory.value,
              memory.metadata ? JSON.stringify(memory.metadata) : null
            );
          }

          result.imported++;
        } catch (error) {
          result.errors++;
          logger.warn('Failed to import memory entry', { error, memory });
        }
      }

      end();
      return result;
    } catch (error) {
      end();
      logger.error('Import failed', error as Error);
      return result;
    }
  }

  /**
   * Compact and optimize storage
   */
  compactStorage(): { before: number; after: number; reclaimed: number } {
    const end = performanceTracker.start('analytics:compact');
    
    try {
      // Get size before
      const beforeSize = (this.queryGet('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()') as any)?.size || 0;

      // Clean up expired cache
      this.db.run(`DELETE FROM analytics_cache WHERE expires_at < datetime('now')`);

      // Vacuum database
      this.db.exec('VACUUM');

      // Analyze for query optimization
      this.db.exec('ANALYZE');

      // Get size after
      const afterSize = (this.queryGet('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()') as any)?.size || 0;

      end();
      return {
        before: beforeSize,
        after: afterSize,
        reclaimed: beforeSize - afterSize,
      };
    } catch (error) {
      end();
      logger.error('Storage compaction failed', error as Error);
      return { before: 0, after: 0, reclaimed: 0 };
    }
  }

  /**
   * Get all tags with usage counts
   */
  getTags(): { tag: string; count: number }[] {
    try {
      return this.db.prepare(`
        SELECT tag, COUNT(*) as count
        FROM memory_tags
        GROUP BY tag
        ORDER BY count DESC
      `).all() as any[];
    } catch {
      return [];
    }
  }

  /**
   * Add tag to memory entry
   */
  addTag(memoryId: number, memoryType: string, tag: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_tags (memory_id, memory_type, tag)
      VALUES (?, ?, ?)
    `).run(memoryId, memoryType, tag.toLowerCase().trim());
  }

  /**
   * Check if semantic search is available
   */
  isSemanticSearchAvailable(): boolean {
    return this.embeddingsEnabled;
  }
}
