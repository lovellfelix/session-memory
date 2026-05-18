#!/usr/bin/env node
import { spawn } from 'node:child_process';

const serverPath = process.argv[2];
if (!serverPath) {
  console.error('Missing server path argument');
  process.exit(2);
}

const timeoutMs = 10000;
const proc = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

let buffer = '';
let nextId = 1;
const pending = new Map();
let serverClosed = false;

function rejectAllPending(reason) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timeout);
    entry.reject(reason instanceof Error ? reason : new Error(String(reason)));
    pending.delete(id);
  }
}

function request(method, params = {}) {
  if (serverClosed) {
    return Promise.reject(new Error(`Server already exited before ${method}`));
  }

  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout for ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    proc.stdin.write(payload);
  });
}

proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof message.id !== 'number') continue;
    const entry = pending.get(message.id);
    if (!entry) continue;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) {
      entry.reject(new Error(message.error.message || 'JSON-RPC error'));
    } else {
      entry.resolve(message.result);
    }
  }
});

proc.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

proc.on('error', (error) => {
  serverClosed = true;
  rejectAllPending(new Error(`Server process error: ${error.message}`));
});

proc.on('exit', (code, signal) => {
  serverClosed = true;
  if (pending.size > 0) {
    rejectAllPending(new Error(`Server exited before replying (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
  }
});

proc.on('close', (code, signal) => {
  serverClosed = true;
  if (pending.size > 0) {
    rejectAllPending(new Error(`Server closed before replying (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
  }
});

(async () => {
  try {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'diagnose-workflow-issue', version: '1.0.0' },
    });

    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

    const tools = await request('tools/list', {});
    const count = Array.isArray(tools?.tools) ? tools.tools.length : 0;
    console.log(`tools=${count}`);
    proc.kill('SIGTERM');
    process.exit(0);
  } catch (error) {
    proc.kill('SIGTERM');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
