import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  ContextSource,
  resolveConfigSearchPaths,
  resolveContextSources,
  resolveMemoryHome,
  resolveSessionDbPath,
} from "./runtime-paths.js";

export interface HarnessAdapter {
  id: string;
  kind: ContextSource["kind"];
  root: string;
  promptDir: string;
  memoryDir?: string;
}

export interface ContextArtifact {
  source: string;
  name: string;
  content: string;
}

export interface HarnessDiagnostic {
  id: string;
  kind: ContextSource["kind"];
  root: string;
  promptDir: string;
  memoryDir?: string;
  promptDirExists: boolean;
  memoryDirExists: boolean;
  availablePromptFiles: string[];
  availableMemoryFiles: string[];
}

export interface RuntimeDiagnostics {
  database: {
    path: string;
    memoryHome: string;
  };
  config: {
    searchPaths: string[];
  };
  harnesses: HarnessDiagnostic[];
}

function readFileSafe(path: string): string {
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf-8");
}

export function getHarnessAdapters(): HarnessAdapter[] {
  return resolveContextSources().map((source) => ({
    id: source.id,
    kind: source.kind,
    root: source.root,
    promptDir: source.promptDir,
    memoryDir: source.memoryDir,
  }));
}

export function collectContextArtifacts(
  promptFilenames: readonly string[],
  curatedFilenames: readonly string[],
): {
  promptModules: ContextArtifact[];
  curatedMarkdown: ContextArtifact[];
} {
  const promptModules: ContextArtifact[] = [];
  const curatedMarkdown: ContextArtifact[] = [];

  for (const source of resolveContextSources()) {
    for (const entry of promptFilenames) {
      const content = readFileSafe(join(source.promptDir, entry));
      if (content.trim().length === 0) {
        continue;
      }
      promptModules.push({
        source: source.kind,
        name: entry,
        content,
      });
    }

    if (!source.memoryDir) {
      continue;
    }

    for (const entry of curatedFilenames) {
      const content = readFileSafe(join(source.memoryDir, entry));
      if (content.trim().length === 0) {
        continue;
      }
      curatedMarkdown.push({
        source: source.kind,
        name: entry,
        content,
      });
    }
  }

  return { promptModules, curatedMarkdown };
}

export function getHarnessDiagnostics(
  promptFilenames: readonly string[],
  curatedFilenames: readonly string[],
): HarnessDiagnostic[] {
  return resolveContextSources().map((source) => ({
    id: source.id,
    kind: source.kind,
    root: source.root,
    promptDir: source.promptDir,
    memoryDir: source.memoryDir,
    promptDirExists: existsSync(source.promptDir),
    memoryDirExists: source.memoryDir ? existsSync(source.memoryDir) : false,
    availablePromptFiles: promptFilenames.filter((entry) => existsSync(join(source.promptDir, entry))),
    availableMemoryFiles: source.memoryDir
      ? curatedFilenames.filter((entry) => existsSync(join(source.memoryDir!, entry)))
      : [],
  }));
}

export function getRuntimeDiagnostics(
  promptFilenames: readonly string[],
  curatedFilenames: readonly string[],
): RuntimeDiagnostics {
  return {
    database: {
      path: resolveSessionDbPath(),
      memoryHome: resolveMemoryHome(),
    },
    config: {
      searchPaths: resolveConfigSearchPaths(),
    },
    harnesses: getHarnessDiagnostics(promptFilenames, curatedFilenames),
  };
}
