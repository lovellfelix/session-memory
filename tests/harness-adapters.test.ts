import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  collectContextArtifacts,
  getHarnessAdapters,
  getHarnessDiagnostics,
  getRuntimeDiagnostics,
} from '../src/harness-adapters.js';

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.SESSION_MEMORY_CONTEXT_ROOT;
  delete process.env.OPENCODE_CONFIG_ROOT;
  delete process.env.PI_AGENT_ROOT;
  delete process.env.SESSION_MEMORY_DB;
  delete process.env.SESSION_MEMORY_CONFIG;

  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('harness-adapters', () => {
  it('discovers generic, OpenCode, and Pi adapters', () => {
    process.env.SESSION_MEMORY_CONTEXT_ROOT = makeTempDir('session-memory-generic-');
    process.env.OPENCODE_CONFIG_ROOT = makeTempDir('session-memory-opencode-');
    process.env.PI_AGENT_ROOT = makeTempDir('session-memory-pi-');

    const adapters = getHarnessAdapters();
    expect(adapters.map(adapter => adapter.kind)).toEqual(['generic', 'opencode', 'pi']);
  });

  it('collects prompt modules and curated markdown from all harnesses', () => {
    const genericRoot = makeTempDir('session-memory-generic-');
    const opencodeRoot = makeTempDir('session-memory-opencode-');
    const piRoot = makeTempDir('session-memory-pi-');

    process.env.SESSION_MEMORY_CONTEXT_ROOT = genericRoot;
    process.env.OPENCODE_CONFIG_ROOT = opencodeRoot;
    process.env.PI_AGENT_ROOT = piRoot;

    mkdirSync(path.join(genericRoot, 'prompts'), { recursive: true });
    mkdirSync(path.join(genericRoot, 'memory'), { recursive: true });
    mkdirSync(path.join(opencodeRoot, 'assistant_prompts'), { recursive: true });
    mkdirSync(path.join(opencodeRoot, 'memory'), { recursive: true });
    mkdirSync(path.join(piRoot, 'prompts'), { recursive: true });

    writeFileSync(path.join(genericRoot, 'prompts', 'modes.md'), '# generic modes');
    writeFileSync(path.join(genericRoot, 'memory', 'user_profile.md'), 'generic profile');
    writeFileSync(path.join(opencodeRoot, 'assistant_prompts', 'system_prompt.md'), '# opencode system');
    writeFileSync(path.join(opencodeRoot, 'memory', 'assistant_rules.md'), 'opencode rules');
    writeFileSync(path.join(piRoot, 'prompts', 'plan.md'), '# pi plan');

    const artifacts = collectContextArtifacts(
      ['modes.md', 'system_prompt.md', 'plan.md'],
      ['user_profile.md', 'assistant_rules.md'],
    );

    expect(artifacts.promptModules).toEqual([
      { source: 'generic', name: 'modes.md', content: '# generic modes' },
      { source: 'opencode', name: 'system_prompt.md', content: '# opencode system' },
      { source: 'pi', name: 'plan.md', content: '# pi plan' },
    ]);
    expect(artifacts.curatedMarkdown).toEqual([
      { source: 'generic', name: 'user_profile.md', content: 'generic profile' },
      { source: 'opencode', name: 'assistant_rules.md', content: 'opencode rules' },
    ]);
  });

  it('reports harness and runtime diagnostics', () => {
    const opencodeRoot = makeTempDir('session-memory-opencode-');
    process.env.OPENCODE_CONFIG_ROOT = opencodeRoot;
    process.env.SESSION_MEMORY_DB = '/tmp/custom-session-memory.db';
    process.env.SESSION_MEMORY_CONFIG = '/tmp/session-memory-config.json';

    mkdirSync(path.join(opencodeRoot, 'assistant_prompts'), { recursive: true });
    writeFileSync(path.join(opencodeRoot, 'assistant_prompts', 'modes.md'), '# modes');

    const harnesses = getHarnessDiagnostics(['modes.md'], ['user_profile.md']);
    expect(harnesses[0]).toMatchObject({
      kind: 'opencode',
      promptDirExists: true,
      availablePromptFiles: ['modes.md'],
    });

    const runtime = getRuntimeDiagnostics(['modes.md'], ['user_profile.md']);
    expect(runtime.database.path).toBe('/tmp/custom-session-memory.db');
    expect(runtime.config.searchPaths[0]).toBe('/tmp/session-memory-config.json');
  });
});
