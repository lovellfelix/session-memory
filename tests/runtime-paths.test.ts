import { describe, expect, it } from '@jest/globals';
import {
  expandHomePath,
  resolveConfigSavePath,
  resolveConfigSearchPaths,
  resolveContextSources,
  resolveEncryptionKeyPath,
  resolveProjectDbPath,
  resolveSessionDbPath,
} from '../src/runtime-paths.js';

describe('runtime-paths', () => {
  const env = {
    HOME: '/tmp/home',
    USERPROFILE: '',
  } as NodeJS.ProcessEnv;

  it('prefers portable explicit DB environment variables', () => {
    const dbPath = resolveSessionDbPath(
      {
        ...env,
        SESSION_MEMORY_DB: '~/custom/session-memory.db',
        SESSION_DB: '/ignored/session.db',
      },
      () => false,
    );

    expect(dbPath).toBe('/tmp/home/custom/session-memory.db');
  });

  it('falls back from canonical DB path to legacy OpenCode path', () => {
    const dbPath = resolveSessionDbPath(env, (candidate) => candidate === '/tmp/home/.opencode/sessions/session.db');
    expect(dbPath).toBe('/tmp/home/.opencode/sessions/session.db');
  });

  it('uses portable project DB path by default', () => {
    const dbPath = resolveProjectDbPath('/workspace/project', env, () => false);
    expect(dbPath).toBe('/workspace/project/.session-memory/memory.db');
  });

  it('supports legacy project DB fallback', () => {
    const dbPath = resolveProjectDbPath(
      '/workspace/project',
      env,
      (candidate) => candidate === '/workspace/project/.nova/memory.db',
    );
    expect(dbPath).toBe('/workspace/project/.nova/memory.db');
  });

  it('builds portable config search paths with legacy fallbacks', () => {
    const paths = resolveConfigSearchPaths('/workspace/project', env);
    expect(paths).toEqual([
      '/workspace/project/.session-memory/config.json',
      '/workspace/project/.pi/session-memory.json',
      '/workspace/project/.opencode/session-memory.json',
      '/workspace/project/.nova/config.json',
      '/tmp/home/.config/session-memory/config.json',
      '/tmp/home/.opencode/session-memory.json',
    ]);
  });

  it('uses portable config save path by default', () => {
    expect(resolveConfigSavePath(env)).toBe('/tmp/home/.config/session-memory/config.json');
  });

  it('uses shared encryption key path in memory home', () => {
    expect(resolveEncryptionKeyPath(env)).toBe('/tmp/home/.agents/memory/.encryption-key');
  });

  it('resolves context sources for generic, OpenCode, and Pi harnesses', () => {
    const sources = resolveContextSources({
      ...env,
      SESSION_MEMORY_CONTEXT_ROOT: '~/context-root',
      OPENCODE_CONFIG_ROOT: '~/oc',
      PI_AGENT_ROOT: '~/pi-agent',
    });

    expect(sources).toEqual([
      {
        id: 'generic:/tmp/home/context-root',
        kind: 'generic',
        root: '/tmp/home/context-root',
        promptDir: '/tmp/home/context-root/prompts',
        memoryDir: '/tmp/home/context-root/memory',
      },
      {
        id: 'opencode',
        kind: 'opencode',
        root: '/tmp/home/oc',
        promptDir: '/tmp/home/oc/assistant_prompts',
        memoryDir: '/tmp/home/oc/memory',
      },
      {
        id: 'pi',
        kind: 'pi',
        root: '/tmp/home/pi-agent',
        promptDir: '/tmp/home/pi-agent/prompts',
        memoryDir: '/tmp/home/pi-agent/memory',
      },
    ]);
  });

  it('expands home directory markers without touching absolute paths', () => {
    expect(expandHomePath('~/file.txt', env)).toBe('/tmp/home/file.txt');
    expect(expandHomePath('/already/absolute', env)).toBe('/already/absolute');
  });
});
