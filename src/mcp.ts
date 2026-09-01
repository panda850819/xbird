#!/usr/bin/env bun

import { extractTweetId } from './lib/extract-tweet-id.js';
import { resolveCredentials } from './lib/cookies.js';
import { TwitterClient } from './lib/twitter-client.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2025-11-25';
const SERVER_INFO = { name: 'xbird-mcp', version: '0.1.0' } as const;

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

const tools = [
  {
    name: 'x_search',
    description: 'Search X posts using the authenticated local xbird session.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        count: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_read',
    description: 'Read one X post by post ID or x.com/twitter.com status URL.',
    inputSchema: {
      type: 'object',
      properties: { tweet: { type: 'string', minLength: 1 } },
      required: ['tweet'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_thread',
    description: 'Read the conversation thread around one X post.',
    inputSchema: {
      type: 'object',
      properties: { tweet: { type: 'string', minLength: 1 } },
      required: ['tweet'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_replies',
    description: 'Read replies to one X post.',
    inputSchema: {
      type: 'object',
      properties: { tweet: { type: 'string', minLength: 1 } },
      required: ['tweet'],
      additionalProperties: false,
    },
  },
] as const;

let clientPromise: Promise<TwitterClient> | null = null;

async function getClient(): Promise<TwitterClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { cookies } = await resolveCredentials({});
      if (!cookies.authToken || !cookies.ct0) {
        throw new Error('Missing X credentials. Log in to x.com locally or configure AUTH_TOKEN and CT0.');
      }
      return new TwitterClient({ cookies });
    })();
  }
  return clientPromise;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid argument: ${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalCount(args: Record<string, unknown>): number {
  const value = args.count;
  if (value === undefined) return 10;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new Error('Invalid argument: count must be an integer between 1 and 100.');
  }
  return value as number;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await getClient();
  switch (name) {
    case 'x_search':
      return client.search(requireString(args, 'query'), optionalCount(args));
    case 'x_read':
      return client.getTweet(extractTweetId(requireString(args, 'tweet')));
    case 'x_thread':
      return client.getThread(extractTweetId(requireString(args, 'tweet')));
    case 'x_replies':
      return client.getReplies(extractTweetId(requireString(args, 'tweet')));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function modernMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/serverInfo': SERVER_INFO,
  };
}

function completeResult(result: Record<string, unknown>, modern: boolean): Record<string, unknown> {
  return modern
    ? { resultType: 'complete', ...result, _meta: modernMeta() }
    : result;
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

export async function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const modern = request.method === 'server/discover' || requestProtocolVersion(request) === MODERN_PROTOCOL_VERSION;

  if (request.id === undefined) {
    // Notifications are intentionally ignored. This includes legacy notifications/initialized.
    return null;
  }

  if (request.method === 'server/discover') {
    return success(
      id,
      completeResult(
        {
          supportedVersions: [MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          instructions: 'Read-only X research tools backed by the local xbird session. Credentials never leave this process.',
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
      instructions: 'Read-only X research tools backed by the local xbird session.',
    });
  }

  if (request.method === 'tools/list') {
    return success(
      id,
      completeResult(
        {
          tools,
          ...(modern ? { ttlMs: 60_000, cacheScope: 'private' } : {}),
        },
        modern,
      ),
    );
  }

  if (request.method === 'tools/call') {
    const params = request.params ?? {};
    const name = typeof params.name === 'string' ? params.name : '';
    const args = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
    if (!name) return failure(id, -32602, 'Invalid params: missing tool name.');

    try {
      const data = await callTool(name, args);
      return success(
        id,
        completeResult(
          {
            content: [{ type: 'text', text: JSON.stringify(data) }],
          },
          modern,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return success(
        id,
        completeResult(
          {
            content: [{ type: 'text', text: message }],
            isError: true,
          },
          modern,
        ),
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
        const message = error instanceof Error ? error.message : String(error);
        response = failure(null, -32700, 'Parse error', message);
      }

      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

if (import.meta.main) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`xbird-mcp fatal: ${message}`);
    process.exitCode = 1;
  });
}
