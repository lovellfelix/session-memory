import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from './logger.js';
import { ConfigError } from './errors.js';
import {
  expandHomePath,
  resolveConfigSavePath,
  resolveConfigSearchPaths,
  resolveProjectDbPath,
  resolveSessionDbPath,
} from './runtime-paths.js';

/**
 * Storage modes for multi-project support (inspired by Nova Memory)
 */
export type StorageMode = 'project' | 'global' | 'multi';

/**
 * Project configuration for multi-project support
 */
export interface ProjectConfig {
  id: string;
  name: string;
  rootPath: string;
  primaryLanguage?: string;
  frameworks?: string[];
  conventions?: Record<string, string>;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Feature flags for enabling/disabling functionality
 */
export interface FeatureFlags {
  taskManagement: boolean;
  knowledgeGraph: boolean;
  semanticSearch: boolean;
  conflictDetection: boolean;
  temporalAnalysis: boolean;
  patternDetection: boolean;
  crossProjectQueries: boolean;
}

/**
 * Tool-level configuration for enabling/disabling individual tools
 */
export interface ToolConfig {
  store_memory: boolean;
  memory_search: boolean;
  memory_query: boolean;
  memory_stats: boolean;
  memory_delete: boolean;
  memory_tags: boolean;
  memory_export: boolean;
  memory_import: boolean;
  search_semantic: boolean;
  search_patterns: boolean;
  search_temporal: boolean;
  search_relationships: boolean;
  analysis_conflicts: boolean;
  analysis_memory_map: boolean;
  analysis_anomalies: boolean;
  task_management: boolean;
  task_board: boolean;
  task_insights: boolean;
  knowledge_graph: boolean;
  project_profile: boolean;
  memory_compact: boolean;
}

/**
 * Multi-project configuration
 */
export interface MultiProjectConfig {
  enabled: boolean;
  includePaths: string[];
  excludePaths?: string[];
  defaultProject?: string;
}

/**
 * Main configuration interface
 */
export interface SessionMemoryConfig {
  version: string;
  storage: {
    mode: StorageMode;
    dbPath: string;
    multiProject?: MultiProjectConfig;
  };
  features: FeatureFlags;
  tools: Partial<ToolConfig>;
  cleanup: {
    enabled: boolean;
    intervalHours: number;
    retentionDays: number;
  };
  performance: {
    maxSamples: number;
    enableMetrics: boolean;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableToolLogs: boolean;
  };
}

const DEFAULT_CONFIG: SessionMemoryConfig = {
  version: '2.0.0',
  storage: {
    mode: 'global',
    dbPath: resolveSessionDbPath(),
  },
  features: {
    taskManagement: true,
    knowledgeGraph: true,
    semanticSearch: false, // Requires optional dependency
    conflictDetection: true,
    temporalAnalysis: true,
    patternDetection: true,
    crossProjectQueries: true,
  },
  tools: {
    // All tools enabled by default
  },
  cleanup: {
    enabled: true,
    intervalHours: 1,
    retentionDays: 30,
  },
  performance: {
    maxSamples: 1000,
    enableMetrics: true,
  },
  logging: {
    level: 'info',
    enableToolLogs: true,
  },
};

/**
 * Configuration manager for session-memory.
 * Supports portable project-local and user-level config paths, with legacy OpenCode/Nova fallbacks.
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: SessionMemoryConfig;
  private configPath: string | null = null;
  private projectConfigs: Map<string, ProjectConfig> = new Map();

  private constructor() {
    this.config = this.loadConfig();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): SessionMemoryConfig {
    const configLocations = resolveConfigSearchPaths();

    for (const location of configLocations) {
      if (existsSync(location)) {
        try {
          const fileContent = readFileSync(location, 'utf-8');
          const userConfig = JSON.parse(fileContent);
          this.configPath = location;
          logger.info('Loaded configuration', { path: location });
          return this.mergeConfig(DEFAULT_CONFIG, userConfig);
        } catch (error) {
          logger.warn(`Failed to parse config at ${location}`, { error });
        }
      }
    }

    // Load from environment variables
    const envConfig = this.loadFromEnv();
    return this.mergeConfig(DEFAULT_CONFIG, envConfig);
  }

  private loadFromEnv(): Partial<SessionMemoryConfig> {
    const config: Partial<SessionMemoryConfig> = {};

    if (process.env.SESSION_MEMORY_DB || process.env.SESSION_DB || process.env.SESSION_DB_PATH) {
      config.storage = { ...DEFAULT_CONFIG.storage, dbPath: resolveSessionDbPath() };
    }

    if (process.env.STORAGE_MODE) {
      config.storage = { 
        ...(config.storage || DEFAULT_CONFIG.storage), 
        mode: process.env.STORAGE_MODE as StorageMode 
      };
    }

    if (process.env.LOG_LEVEL) {
      config.logging = { 
        ...DEFAULT_CONFIG.logging, 
        level: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' 
      };
    }

    if (process.env.RETENTION_DAYS) {
      config.cleanup = { 
        ...DEFAULT_CONFIG.cleanup, 
        retentionDays: parseInt(process.env.RETENTION_DAYS, 10) 
      };
    }

    if (process.env.ENABLE_SEMANTIC_SEARCH === 'true') {
      config.features = { ...DEFAULT_CONFIG.features, semanticSearch: true };
    }

    return config;
  }

  private mergeConfig(base: SessionMemoryConfig, override: Partial<SessionMemoryConfig>): SessionMemoryConfig {
    return {
      ...base,
      ...override,
      storage: { ...base.storage, ...override.storage },
      features: { ...base.features, ...override.features },
      tools: { ...base.tools, ...override.tools },
      cleanup: { ...base.cleanup, ...override.cleanup },
      performance: { ...base.performance, ...override.performance },
      logging: { ...base.logging, ...override.logging },
    };
  }

  getConfig(): SessionMemoryConfig {
    return this.config;
  }

  getStorageMode(): StorageMode {
    return this.config.storage.mode;
  }

  getDbPath(): string {
    let dbPath = this.config.storage.dbPath;

    if (this.config.storage.mode === 'project') {
      dbPath = resolveProjectDbPath();
    }

    dbPath = expandHomePath(dbPath);

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    return dbPath;
  }

  isFeatureEnabled(feature: keyof FeatureFlags): boolean {
    return this.config.features[feature] ?? false;
  }

  isToolEnabled(tool: keyof ToolConfig): boolean {
    // If not specified, tool is enabled by default
    return this.config.tools[tool] ?? true;
  }

  getMultiProjectPaths(): string[] {
    if (!this.config.storage.multiProject?.enabled) {
      return [];
    }
    return this.config.storage.multiProject.includePaths.map(p => expandHomePath(p));
  }

  /**
   * Register a project for multi-project support
   */
  registerProject(project: Omit<ProjectConfig, 'createdAt' | 'updatedAt'>): ProjectConfig {
    const now = new Date().toISOString();
    const fullProject: ProjectConfig = {
      ...project,
      createdAt: now,
      updatedAt: now,
    };
    this.projectConfigs.set(project.id, fullProject);
    logger.info('Registered project', { projectId: project.id, name: project.name });
    return fullProject;
  }

  getProject(projectId: string): ProjectConfig | undefined {
    return this.projectConfigs.get(projectId);
  }

  getAllProjects(): ProjectConfig[] {
    return Array.from(this.projectConfigs.values());
  }

  /**
   * Save current configuration to file
   */
  saveConfig(path?: string): void {
    const savePath = path || this.configPath || resolveConfigSavePath();
    
    try {
      const dir = dirname(savePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(savePath, JSON.stringify(this.config, null, 2));
      logger.info('Configuration saved', { path: savePath });
    } catch (error) {
      throw new ConfigError(`Failed to save configuration to ${savePath}`, { error });
    }
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(updates: Partial<SessionMemoryConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
    logger.info('Configuration updated');
  }
}

export const configManager = ConfigManager.getInstance();
