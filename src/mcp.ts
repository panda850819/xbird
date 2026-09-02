#!/usr/bin/env bun

import { resolveCredentials } from './lib/cookies.js';
import { extractTweetId } from './lib/extract-tweet-id.js';
import { TwitterClient } from './lib/twitter-client.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2025-11-25';
const SERVER_INFO = { name: 'xbird-mcp', version: '0.1.0' } as const;
const MAX_QUERY_LENGTH = 512;
const MAX_TWEET_INPUT_LENGTH = 2048;
const DEFAULT_CLIENT_TIMEOUT_MS = 20_000;
const MAX_CLIENT_TIMEOUT_MS = 300_000;
const MAX_REQUEST_LINE_LENGTH = 1_000_000;
const TWEET_ID_PATTERN = /^\d+$/;
const TWEET_URL_PATTERN = /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)\/?$/i;
const CREDENTIAL_ENV_KEYS = ['AUTH_TOKEN', 'CT0', 'TWITTER_AUTH_TOKEN', 'TWITTER_CT0'] as const;

type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type ReadOnlyTwitterClient = Pick<TwitterClient, 'search' | 'getTweet' | 'getThread' | 'getReplies'>;
type ClientFactory = () => Promise<ReadOnlyTwitterClient>;

type McpHandlerOptions = {
  createClient?: ClientFactory;
  secrets?: readonly string[];
};

type StringOptions = {
  allowEmpty?: boolean;
  maxLength?: number;
};

const tools = [
  {
    name: 'x_search',
    description: 'Search X posts using the authenticated local xbird session.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH },
        count: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_read',
    description: 'Read one X post by post ID or x.com/twitter.com status URL.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { tweet: { type: 'string', minLength: 1, maxLength: MAX_TWEET_INPUT_LENGTH } },
      required: ['tweet'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_thread',
    description: 'Read the conversation thread around one X post.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { tweet: { type: 'string', minLength: 1, maxLength: MAX_TWEET_INPUT_LENGTH } },
      required: ['tweet'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_replies',
    description: 'Read replies to one X post.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { tweet: { type: 'string', minLength: 1, maxLength: MAX_TWEET_INPUT_LENGTH } },
      required: ['tweet'],
      additionalProperties: false,
    },
  },
] as const;

const toolArgumentKeys: Record<string, readonly string[]> = {
  x_search: ['query', 'count'],
  x_read: ['tweet'],
  x_thread: ['tweet'],
  x_replies: ['tweet'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function parseRequest(value: unknown): JsonRpcRequest | null {
  if (!isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') {
    return null;
  }
  if (Object.hasOwn(value, 'id') && !isJsonRpcId(value.id)) {
    return null;
  }
  return value as JsonRpcRequest;
}

function requireString(args: Record<string, unknown>, key: string, options: StringOptions = {}): string {
  const value = args[key];
  const allowEmpty = options.allowEmpty ?? false;
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`Invalid argument: ${key} must be a ${allowEmpty ? '' : 'non-empty '}string.`);
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new Error(`Invalid argument: ${key} must be at most ${options.maxLength} characters.`);
  }
  return allowEmpty ? value : value.trim();
}

function optionalCount(args: Record<string, unknown>): number {
  const value = args.count;
  if (value === undefined) {
    return 10;
  }
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new Error('Invalid argument: count must be an integer between 1 and 100.');
  }
  return value as number;
}

function requireTweetId(args: Record<string, unknown>): string {
  const input = requireString(args, 'tweet', { maxLength: MAX_TWEET_INPUT_LENGTH });
  if (TWEET_ID_PATTERN.test(input)) {
    return input;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Invalid argument: tweet must be a numeric X post ID or status URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid argument: tweet must be a numeric X post ID or status URL.');
  }
  if (url.username || url.password) {
    throw new Error('Invalid argument: tweet must be a numeric X post ID or status URL.');
  }
  const hostname = url.hostname.toLowerCase();
  if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(hostname)) {
    throw new Error('Invalid argument: tweet must be a numeric X post ID or status URL.');
  }
  const match = TWEET_URL_PATTERN.exec(url.pathname);
  if (!match) {
    throw new Error('Invalid argument: tweet must be a numeric X post ID or status URL.');
  }
  return extractTweetId(input);
}

function validateToolArguments(name: string, args: Record<string, unknown>): void {
  const allowed = toolArgumentKeys[name];
  if (!allowed) {
    throw new Error(`Unknown tool: ${name}`);
  }
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      throw new Error(`Invalid argument: unexpected property ${key}.`);
    }
  }
}

function clientTimeoutMs(): number {
  const candidate = Number.parseInt(process.env.XBIRD_TIMEOUT_MS ?? '', 10);
  if (Number.isInteger(candidate) && candidate > 0 && candidate <= MAX_CLIENT_TIMEOUT_MS) {
    return candidate;
  }
  return DEFAULT_CLIENT_TIMEOUT_MS;
}

function collectEnvironmentSecrets(): string[] {
  return CREDENTIAL_ENV_KEYS.flatMap((key) => {
    const value = process.env[key];
    return value ? [value] : [];
  });
}

function redactSecrets(value: string, secrets: Set<string>): string {
  let redacted = value;
  const orderedSecrets = [...secrets].sort((left, right) => right.length - left.length);
  for (const secret of orderedSecrets) {
    if (secret.length > 0) {
      redacted = redacted.replaceAll(secret, '[REDACTED]');
    }
  }
  return redacted;
}

function serializeResult(value: unknown, secrets: Set<string>): string {
  try {
    const serialized = JSON.stringify(value);
    return redactSecrets(serialized === undefined ? 'undefined' : serialized, secrets);
  } catch {
    return 'Result could not be serialized.';
  }
}

function errorMessage(error: unknown, secrets: Set<string>): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, secrets);
}

function requestProtocolVersion(request: JsonRpcRequest): string | undefined {
  if (!isRecord(request.params) || !isRecord(request.params._meta)) {
    return undefined;
  }
  const version = request.params._meta['io.modelcontextprotocol/protocolVersion'];
  return typeof version === 'string' ? version : undefined;
}

function requestParams(request: JsonRpcRequest): Record<string, unknown> {
  if (request.params === undefined) {
    return {};
  }
  if (!isRecord(request.params)) {
    throw new Error('Invalid params: params must be an object.');
  }
  return request.params;
}

function toolArguments(params: Record<string, unknown>): Record<string, unknown> {
  if (params.arguments === undefined) {
    return {};
  }
  if (!isRecord(params.arguments)) {
    throw new Error('Invalid params: arguments must be an object.');
  }
  return params.arguments;
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

export function createMcpHandler(options: McpHandlerOptions = {}) {
  const secrets = new Set([...collectEnvironmentSecrets(), ...(options.secrets ?? [])]);
  const createClient: ClientFactory =
    options.createClient ??
    (async () => {
      const { cookies } = await resolveCredentials({});
      for (const value of [cookies.authToken, cookies.ct0, cookies.cookieHeader]) {
        if (value) {
          secrets.add(value);
        }
      }
      if (!cookies.authToken || !cookies.ct0) {
        throw new Error('Missing X credentials. Log in to x.com locally or configure AUTH_TOKEN and CT0.');
      }
      return new TwitterClient({ cookies, timeoutMs: clientTimeoutMs() });
    });
  let clientPromise: Promise<ReadOnlyTwitterClient> | null = null;

  async function getClient(): Promise<ReadOnlyTwitterClient> {
    if (!clientPromise) {
      clientPromise = createClient();
    }
    return clientPromise;
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    validateToolArguments(name, args);
    switch (name) {
      case 'x_search': {
        const query = requireString(args, 'query', { maxLength: MAX_QUERY_LENGTH });
        const count = optionalCount(args);
        return (await getClient()).search(query, count);
      }
      case 'x_read': {
        const tweetId = requireTweetId(args);
        return (await getClient()).getTweet(tweetId);
      }
      case 'x_thread': {
        const tweetId = requireTweetId(args);
        return (await getClient()).getThread(tweetId);
      }
      case 'x_replies': {
        const tweetId = requireTweetId(args);
        return (await getClient()).getReplies(tweetId);
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  return async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;
    const modern = request.method === 'server/discover' || requestProtocolVersion(request) === MODERN_PROTOCOL_VERSION;

    if (request.id === undefined) {
      return null;
    }

    let params: Record<string, unknown>;
    try {
      params = requestParams(request);
    } catch (error) {
      return failure(id, -32602, errorMessage(error, secrets));
    }

    if (request.method === 'server/discover') {
      return success(
        id,
        completeResult(
          {
            supportedVersions: [MODERN_PROTOCOL_VERSION],
            capabilities: { tools: {} },
            instructions:
              'Read-only X research tools backed by the local xbird session. Credentials never leave this process.',
          },
          true,
        ),
      );
    }

    if (request.method === 'initialize') {
      const requestedVersion = params.protocolVersion;
      if (requestedVersion !== undefined && typeof requestedVersion !== 'string') {
        return failure(id, -32602, 'Invalid params: protocolVersion must be a string.');
      }
      if (typeof requestedVersion === 'string' && requestedVersion !== LEGACY_PROTOCOL_VERSION) {
        return failure(id, -32602, `Unsupported protocol version: ${requestedVersion}`);
      }
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
      try {
        const name = typeof params.name === 'string' ? params.name : '';
        if (!name) {
          return failure(id, -32602, 'Invalid params: missing tool name.');
        }
        const data = await callTool(name, toolArguments(params));
        const result: Record<string, unknown> = {
          content: [{ type: 'text', text: serializeResult(data, secrets) }],
        };
        if (isRecord(data) && data.success === false) {
          result.isError = true;
        }
        return success(id, completeResult(result, modern));
      } catch (error) {
        const message = errorMessage(error, secrets);
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
  };
}

const defaultHandler = createMcpHandler();

export function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  return defaultHandler(request);
}

async function run(): Promise<void> {
  process.stdin.setEncoding('utf8');
  let buffer = '';

  const processLine = async (rawLine: string): Promise<void> => {
    if (rawLine.length > MAX_REQUEST_LINE_LENGTH) {
      process.stdout.write(`${JSON.stringify(failure(null, -32600, 'Request too large'))}\n`);
      return;
    }
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    let response: JsonRpcResponse | null;
    try {
      const parsed = parseRequest(JSON.parse(line));
      response = parsed ? await defaultHandler(parsed) : failure(null, -32600, 'Invalid Request');
    } catch {
      response = failure(null, -32700, 'Parse error');
    }
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  };

  for await (const chunk of process.stdin) {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        break;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await processLine(line);
    }
    if (buffer.length > MAX_REQUEST_LINE_LENGTH) {
      process.stdout.write(`${JSON.stringify(failure(null, -32600, 'Request too large'))}\n`);
      buffer = '';
    }
  }

  if (buffer.trim()) {
    await processLine(buffer);
  }
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(`xbird-mcp fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
