import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from '@jest/globals';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const MCP_TIMEOUT_MS = 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class McpTestClient {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
  private initialized = false;

  constructor(private readonly env: NodeJS.ProcessEnv) {
    this.proc = spawn('node', ['--loader', 'ts-node/esm', 'src/index.ts'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...env,
      },
    });

    this.proc.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.proc.stderr.on('data', () => {});
    this.proc.on('close', () => {
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('MCP server exited during test'));
      }
      this.pending.clear();
    });
  }

  private onStdout(chunk: Buffer) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (typeof message.id !== 'number') continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'MCP request failed'));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private async request(method: string, params?: Record<string, unknown>) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };

    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, MCP_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async initialize() {
    if (this.initialized) return;
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'session-memory-jest', version: '1.0.0' },
    });
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    this.initialized = true;
  }

  async listTools() {
    await this.initialize();
    return this.request('tools/list', {});
  }

  async callTool(name: string, args: Record<string, unknown>) {
    await this.initialize();
    return this.request('tools/call', { name, arguments: args });
  }

  async stop() {
    await new Promise<void>((resolve) => {
      if (this.proc.killed || this.proc.exitCode !== null) {
        resolve();
        return;
      }
      this.proc.once('close', () => resolve());
      this.proc.kill('SIGTERM');
    });
  }
}

function extractText(result: any): string {
  return Array.isArray(result?.content)
    ? result.content.filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('\n')
    : '';
}

describe('Harness MCP integration', () => {
  const testRoot = mkdtempSync(path.join(tmpdir(), 'session-memory-open-code-'));
  const sessionDbPath = path.join(testRoot, 'memory', 'session.db');
  const opencodeRoot = path.join(testRoot, 'opencode');
  const piRoot = path.join(testRoot, 'pi-agent');
  const claudeRoot = path.join(testRoot, 'claude');
  let client: McpTestClient;

  beforeAll(() => {
    mkdirSync(path.dirname(sessionDbPath), { recursive: true });
    mkdirSync(path.join(opencodeRoot, 'assistant_prompts'), { recursive: true });
    mkdirSync(path.join(opencodeRoot, 'memory'), { recursive: true });
    mkdirSync(path.join(piRoot, 'prompts'), { recursive: true });
    mkdirSync(path.join(piRoot, 'memory'), { recursive: true });
    mkdirSync(path.join(claudeRoot, 'prompts'), { recursive: true });
    mkdirSync(path.join(claudeRoot, 'memory'), { recursive: true });

    writeFileSync(path.join(opencodeRoot, 'assistant_prompts', 'modes.md'), '# open modes');
    writeFileSync(path.join(opencodeRoot, 'memory', 'assistant_rules.md'), 'open rules');
    writeFileSync(path.join(piRoot, 'prompts', 'plan.md'), '# pi plan');
    writeFileSync(path.join(piRoot, 'memory', 'user_profile.md'), 'pi profile');
    writeFileSync(path.join(claudeRoot, 'prompts', 'workflow.md'), '# claude workflow');
    writeFileSync(path.join(claudeRoot, 'memory', 'assistant_rules.md'), 'claude rules');

  });

  beforeEach(async () => {
    client = new McpTestClient({
      SESSION_MEMORY_DB: sessionDbPath,
      OPENCODE_CONFIG_ROOT: opencodeRoot,
      PI_AGENT_ROOT: piRoot,
      CLAUDE_CONFIG_ROOT: claudeRoot,
      LOG_LEVEL: 'error',
    });

    await client.initialize();
  }, 30000);

  afterEach(async () => {
    await client.stop();
  });

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('lists the real MCP tools from the running server', async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((tool: any) => tool.name);

    expect(toolNames).toContain('store_session_context');
    expect(toolNames).toContain('retrieve_session_context');
    expect(toolNames).toContain('assemble_active_context');
    expect(toolNames).toContain('server_health');
    expect(toolNames).toContain('record_artifact_read');
    expect(toolNames).toContain('get_artifact_reads');
    expect(toolNames).toContain('get_autodream_metrics');
  });

  it('stores and retrieves session context using the real runtime schema', async () => {
    const sessionId = 'integration-session-001';

    const stored = await client.callTool('store_session_context', {
      session_id: sessionId,
      context_type: 'workflow',
      key: 'plan',
      value: 'Implement portability adapters',
      metadata: { harness: 'opencode', phase: 'implementation' },
    });
    expect(extractText(stored)).toContain('Context stored: plan');

    const retrieved = await client.callTool('retrieve_session_context', {
      session_id: sessionId,
      context_type: 'workflow',
      key: 'plan',
    });

    const contexts = JSON.parse(extractText(retrieved));
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      session_id: sessionId,
      context_type: 'workflow',
      key: 'plan',
      value: 'Implement portability adapters',
    });
  });

  it('returns manifest runtime metadata with adapters and config diagnostics', async () => {
    const manifest = await client.callTool('get_tool_manifest', { include_schemas: false });
    const parsed = JSON.parse(extractText(manifest));

    expect(parsed.server.name).toBe('@lovellfelix/mcp-session-memory');
    expect(parsed.db.path).toBe(sessionDbPath);
    expect(parsed.adapters.map((adapter: any) => adapter.kind)).toEqual(['opencode', 'pi', 'claude']);
    expect(parsed.runtime.database.path).toBe(sessionDbPath);
    expect(parsed.runtime.harnesses[0]).toHaveProperty('availablePromptFiles');
  });

  it('reports adapter diagnostics through server_health', async () => {
    const health = await client.callTool('server_health', { include_stats: true, include_integrity: true });
    const parsed = JSON.parse(extractText(health));

    expect(parsed.status).toBe('healthy');
    expect(parsed.database.path).toBe(sessionDbPath);
    expect(parsed.integrity).toMatchObject({ ok: true });
    expect(parsed.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'opencode', promptDirExists: true }),
        expect.objectContaining({ kind: 'pi', promptDirExists: true }),
        expect.objectContaining({ kind: 'claude', promptDirExists: true }),
      ]),
    );
    expect(parsed.stats).toMatchObject({
      sessions: expect.any(Object),
      contexts: expect.any(Object),
      preferences: expect.any(Object),
      artifactReads: expect.any(Object),
      autodreamRuns: expect.any(Object),
    });
  });

  it('assembles active context from OpenCode, Pi, and Claude prompt sources', async () => {
    const response = await client.callTool('assemble_active_context', {
      query: 'resume work on the portability plan',
      session_id: 'integration-session-002',
      limit: 5,
    });
    const parsed = JSON.parse(extractText(response));

    expect(parsed.prompt_modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'opencode', name: 'modes.md', content: '# open modes' }),
        expect.objectContaining({ source: 'pi', name: 'plan.md', content: '# pi plan' }),
        expect.objectContaining({ source: 'claude', name: 'workflow.md', content: '# claude workflow' }),
      ]),
    );
    expect(parsed.curated_markdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'opencode', name: 'assistant_rules.md', content: 'open rules' }),
        expect.objectContaining({ source: 'pi', name: 'user_profile.md', content: 'pi profile' }),
        expect.objectContaining({ source: 'claude', name: 'assistant_rules.md', content: 'claude rules' }),
      ]),
    );
  });

  it('records durable artifact reads and exposes autodream metrics queries', async () => {
    const stored = await client.callTool('record_artifact_read', {
      artifact_path: '/tmp/test-artifact.md',
      artifact_type: 'project-memory',
      project_id: 'dotfiles',
      session_id: 'integration-session-003',
      harness: 'pi',
      query: 'resume dotfiles memory',
      score: 9.5,
      metadata: { source: 'jest' },
    });
    expect(extractText(stored)).toContain('Artifact read recorded:');

    const reads = await client.callTool('get_artifact_reads', {
      project_id: 'dotfiles',
      session_id: 'integration-session-003',
      harness: 'pi',
    });
    const parsedReads = JSON.parse(extractText(reads));
    expect(parsedReads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifact_path: '/tmp/test-artifact.md',
          artifact_type: 'project-memory',
          project_id: 'dotfiles',
          session_id: 'integration-session-003',
          harness: 'pi',
        }),
      ]),
    );

    const metrics = await client.callTool('get_autodream_metrics', {
      project: 'dotfiles',
      session_id: 'integration-session-003',
      limit: 5,
    });
    expect(JSON.parse(extractText(metrics))).toEqual([]);
  });
});
