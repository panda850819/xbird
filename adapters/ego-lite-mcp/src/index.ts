#!/usr/bin/env bun

import { spawn } from 'node:child_process';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2025-11-25';
const SERVER_INFO = { name: 'ego-lite-mcp', version: '0.1.0' } as const;
const DEFAULT_TIMEOUT_MS = 30_000;

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};
type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Runner = (script: string) => Promise<unknown>;

const tools = [
  {
    name: 'browser_list_spaces',
    description: 'List Ego Lite task spaces without changing ownership.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browser_list_tabs',
    description: 'List tabs in an MCP-owned Ego Lite task space.',
    inputSchema: taskSchema(),
  },
  {
    name: 'browser_open',
    description: 'Open or reuse an HTTP(S) URL in an MCP-owned Ego Lite task space.',
    inputSchema: {
      type: 'object',
      properties: {
        task: taskProperty(),
        url: { type: 'string', minLength: 1 },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Return Ego Lite semantic snapshot text for the current tab.',
    inputSchema: taskSchema(),
  },
  {
    name: 'browser_page_info',
    description: 'Return URL, title, viewport and dialog state for the current tab.',
    inputSchema: taskSchema(),
  },
  {
    name: 'browser_click',
    description: 'Click a semantic Ego Lite target such as @12, CSS, xpath=, or loc=.',
    inputSchema: targetSchema(),
  },
  {
    name: 'browser_fill',
    description: 'Fill a semantic input target with text.',
    inputSchema: {
      type: 'object',
      properties: {
        task: taskProperty(),
        target: { type: 'string', minLength: 1 },
        text: { type: 'string' },
      },
      required: ['target', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press one keyboard key in the current Ego Lite tab.',
    inputSchema: {
      type: 'object',
      properties: {
        task: taskProperty(),
        key: { type: 'string', minLength: 1, maxLength: 64 },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll vertically by a bounded number of CSS pixels.',
    inputSchema: {
      type: 'object',
      properties: {
        task: taskProperty(),
        dy: { type: 'integer', minimum: -10000, maximum: 10000 },
      },
      required: ['dy'],
      additionalProperties: false,
    },
  },
] as const;

function taskProperty() {
  return {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    description: 'Logical MCP task name. Names are isolated under the ego-lite-mcp prefix.',
    default: 'default',
  };
}

function taskSchema() {
  return {
    type: 'object',
    properties: { task: taskProperty() },
    additionalProperties: false,
  };
}

function targetSchema() {
  return {
    type: 'object',
    properties: {
      task: taskProperty(),
      target: { type: 'string', minLength: 1 },
    },
    required: ['target'],
    additionalProperties: false,
  };
}

function requireString(args: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = args[key];
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`Invalid argument: ${key} must be a ${allowEmpty ? '' : 'non-empty '}string.`);
  }
  return allowEmpty ? value : value.trim();
}

function taskName(args: Record<string, unknown>): string {
  const raw = args.task === undefined ? 'default' : requireString(args, 'task');
  if (raw.length > 80) throw new Error('Invalid argument: task must be at most 80 characters.');
  return `ego-lite-mcp:${raw}`;
}

function requireUrl(args: Record<string, unknown>): string {
  const raw = requireString(args, 'url');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid argument: url must be an absolute URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid argument: only http:// and https:// URLs are allowed.');
  }
  return url.toString();
}

function requireInteger(args: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = args[key];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Invalid argument: ${key} must be an integer between ${min} and ${max}.`);
  }
  return value as number;
}

function emit(expression: string): string {
  return `const __result = await (${expression});\ncliLog(JSON.stringify({ ok: true, result: __result }));`;
}

function withTask(task: string, body: string): string {
  return `const __task = await useOrCreateTaskSpace(${JSON.stringify(task)});\n${body}`;
}

export function scriptForTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'browser_list_spaces':
      return emit('listTaskSpaces()');
    case 'browser_list_tabs':
      return withTask(taskName(args), emit('listTabs()'));
    case 'browser_open': {
      const task = taskName(args);
      const url = requireUrl(args);
      return withTask(
        task,
        `const __tab = await openOrReuseTab(${JSON.stringify(url)}, { wait: true, timeout: 20 });\n${emit('pageInfo()')}`,
      );
    }
    case 'browser_snapshot':
      return withTask(taskName(args), emit('snapshotText()'));
    case 'browser_page_info':
      return withTask(taskName(args), emit('pageInfo()'));
    case 'browser_click': {
      const target = requireString(args, 'target');
      return withTask(taskName(args), `await click(${JSON.stringify(target)});\n${emit('pageInfo()')}`);
    }
    case 'browser_fill': {
      const target = requireString(args, 'target');
      const text = requireString(args, 'text', true);
      return withTask(
        taskName(args),
        `await fillInput(${JSON.stringify(target)}, ${JSON.stringify(text)});\n${emit('pageInfo()')}`,
      );
    }
    case 'browser_press_key': {
      const key = requireString(args, 'key');
      if (key.length > 64) throw new Error('Invalid argument: key must be at most 64 characters.');
      return withTask(taskName(args), `await pressKey(${JSON.stringify(key)});\n${emit('pageInfo()')}`);
    }
    case 'browser_scroll': {
      const dy = requireInteger(args, 'dy', -10000, 10000);
      return withTask(taskName(args), `await scrollBy(${dy});\n${emit('pageInfo()')}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function runEgoBrowser(script: string): Promise<unknown> {
  const binary = process.env.EGO_BROWSER_BIN?.trim() || 'ego-browser';
  const timeoutMs = Number.parseInt(process.env.EGO_LITE_MCP_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`ego-browser timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ego-browser exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
        return;
      }
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const last = lines.at(-1);
      if (!last) {
        reject(new Error('ego-browser returned no cliLog output.'));
        return;
      }
      try {
        const parsed = JSON.parse(last) as { ok?: boolean; result?: unknown };
        if (!parsed.ok) throw new Error('ego-browser returned an invalid result envelope.');
        resolve(parsed.result);
      } catch (error) {
        reject(new Error(`Could not parse ego-browser output: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

    child.stdin.end(`${script}\n`);
  });
}

function modernMeta(): Record<string, unknown> {
  return { 'io.modelcontextprotocol/serverInfo': SERVER_INFO };
}

function completeResult(result: Record<string, unknown>, modern: boolean): Record<string, unknown> {
  return modern ? { resultType: 'complete', ...result, _meta: modernMeta() } : result;
}

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function requestProtocolVersion(request: JsonRpcRequest): string | undefined {
  const meta = request.params?._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const version = (meta as Record<string, unknown>)['io.modelcontextprotocol/protocolVersion'];
  return typeof version === 'string' ? version : undefined;
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  runner: Runner = runEgoBrowser,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const modern = request.method === 'server/discover' || requestProtocolVersion(request) === MODERN_PROTOCOL_VERSION;

  if (request.id === undefined) return null;

  if (request.method === 'server/discover') {
    return success(
      id,
      completeResult(
        {
          supportedVersions: [MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          instructions:
            'Constrained local Ego Lite browser tools. No arbitrary JavaScript, CDP, shell, fetch, or file upload is exposed.',
        },
        true,
      ),
    );
  }

  if (request.method === 'initialize') {
    return success(id, {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: 'Constrained local Ego Lite browser tools over stdio.',
    });
  }

  if (request.method === 'tools/list') {
    return success(id, completeResult({ tools, ...(modern ? { ttlMs: 60_000, cacheScope: 'private' } : {}) }, modern));
  }

  if (request.method === 'tools/call') {
    const params = request.params ?? {};
    const name = typeof params.name === 'string' ? params.name : '';
    const args = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
    if (!name) return failure(id, -32602, 'Invalid params: missing tool name.');

    try {
      const script = scriptForTool(name, args);
      const data = await runner(script);
      return success(
        id,
        completeResult({ content: [{ type: 'text', text: JSON.stringify(data) }] }, modern),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return success(
        id,
        completeResult({ content: [{ type: 'text', text: message }], isError: true }, modern),
      );
    }
  }

  return failure(id, -32601, `Method not found: ${request.method}`);
}

async function run(): Promise<void> {
  process.stdin.setEncoding('utf8');
  let buffer = '';

  for await (const chunk of process.stdin) {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let response: JsonRpcResponse | null;
      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
          response = failure(request.id ?? null, -32600, 'Invalid Request');
        } else {
          response = await handleMcpRequest(request);
        }
      } catch (error) {
        response = failure(null, -32700, 'Parse error', error instanceof Error ? error.message : String(error));
      }

      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(`ego-lite-mcp fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
