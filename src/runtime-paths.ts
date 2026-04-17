import { existsSync } from "fs";
import { join } from "path";

export type HarnessKind = "generic" | "opencode" | "pi";

export interface ContextSource {
  id: string;
  kind: HarnessKind;
  root: string;
  promptDir: string;
  memoryDir?: string;
}

type Env = NodeJS.ProcessEnv;
type ExistsFn = (path: string) => boolean;

function uniquePaths(paths: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of paths) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

export function getHomeDir(env: Env = process.env): string {
  return env.HOME || env.USERPROFILE || "";
}

export function expandHomePath(filePath: string, env: Env = process.env): string {
  if (!filePath) return filePath;
  if (filePath.startsWith("~/")) {
    return join(getHomeDir(env), filePath.slice(2));
  }
  return filePath;
}

export function resolveMemoryHome(env: Env = process.env): string {
  const configuredHome = env.SESSION_MEMORY_HOME;
  if (configuredHome) {
    return expandHomePath(configuredHome, env);
  }

  return join(getHomeDir(env), ".agents", "memory");
}

export function resolveCanonicalSessionDbPath(env: Env = process.env): string {
  return join(resolveMemoryHome(env), "session.db");
}

export function resolveLegacySessionDbPath(env: Env = process.env): string {
  return join(getHomeDir(env), ".opencode", "sessions", "session.db");
}

export function resolveSessionDbPath(
  env: Env = process.env,
  pathExists: ExistsFn = existsSync,
): string {
  const explicitPath =
    env.SESSION_MEMORY_DB ||
    env.SESSION_DB ||
    env.SESSION_DB_PATH;

  if (explicitPath) {
    return expandHomePath(explicitPath, env);
  }

  const canonicalDbPath = resolveCanonicalSessionDbPath(env);
  const legacyDbPath = resolveLegacySessionDbPath(env);

  if (pathExists(canonicalDbPath)) {
    return canonicalDbPath;
  }

  if (pathExists(legacyDbPath)) {
    return legacyDbPath;
  }

  return canonicalDbPath;
}

export function resolveEncryptionKeyPath(env: Env = process.env): string {
  if (env.SESSION_ENCRYPTION_KEY_FILE) {
    return expandHomePath(env.SESSION_ENCRYPTION_KEY_FILE, env);
  }

  return join(resolveMemoryHome(env), ".encryption-key");
}

export function resolveProjectDbPath(
  cwd: string = process.cwd(),
  env: Env = process.env,
  pathExists: ExistsFn = existsSync,
): string {
  const explicitProjectDb = env.SESSION_MEMORY_PROJECT_DB;
  if (explicitProjectDb) {
    return expandHomePath(explicitProjectDb, env);
  }

  const portableProjectDbPath = join(cwd, ".session-memory", "memory.db");
  const legacyProjectDbPath = join(cwd, ".nova", "memory.db");

  if (pathExists(portableProjectDbPath)) {
    return portableProjectDbPath;
  }

  if (pathExists(legacyProjectDbPath)) {
    return legacyProjectDbPath;
  }

  return portableProjectDbPath;
}

export function resolveConfigSearchPaths(
  cwd: string = process.cwd(),
  env: Env = process.env,
): string[] {
  const homeDir = getHomeDir(env);

  return uniquePaths([
    env.SESSION_MEMORY_CONFIG ? expandHomePath(env.SESSION_MEMORY_CONFIG, env) : undefined,
    join(cwd, ".session-memory", "config.json"),
    join(cwd, ".pi", "session-memory.json"),
    join(cwd, ".opencode", "session-memory.json"),
    join(cwd, ".nova", "config.json"),
    join(homeDir, ".config", "session-memory", "config.json"),
    join(homeDir, ".opencode", "session-memory.json"),
  ]);
}

export function resolveConfigSavePath(env: Env = process.env): string {
  if (env.SESSION_MEMORY_CONFIG) {
    return expandHomePath(env.SESSION_MEMORY_CONFIG, env);
  }

  return join(getHomeDir(env), ".config", "session-memory", "config.json");
}

export function resolveContextSources(env: Env = process.env): ContextSource[] {
  const homeDir = getHomeDir(env);
  const sources: ContextSource[] = [];

  const addSource = (source: ContextSource | null) => {
    if (!source) return;
    if (sources.some(existing => existing.id === source.id || existing.root === source.root)) {
      return;
    }
    sources.push(source);
  };

  if (env.SESSION_MEMORY_CONTEXT_ROOT) {
    const root = expandHomePath(env.SESSION_MEMORY_CONTEXT_ROOT, env);
    addSource({
      id: `generic:${root}`,
      kind: "generic",
      root,
      promptDir: join(root, "prompts"),
      memoryDir: join(root, "memory"),
    });
  }

  const openCodeRoot = expandHomePath(
    env.OPENCODE_CONFIG_ROOT || join(homeDir, ".config", "opencode"),
    env,
  );
  addSource({
    id: "opencode",
    kind: "opencode",
    root: openCodeRoot,
    promptDir: join(openCodeRoot, "assistant_prompts"),
    memoryDir: join(openCodeRoot, "memory"),
  });

  const piRoot = expandHomePath(
    env.PI_AGENT_ROOT || join(homeDir, ".pi", "agent"),
    env,
  );
  addSource({
    id: "pi",
    kind: "pi",
    root: piRoot,
    promptDir: join(piRoot, "prompts"),
    memoryDir: join(piRoot, "memory"),
  });

  return sources;
}
