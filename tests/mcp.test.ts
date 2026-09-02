import { describe, expect, it } from 'vitest';
import { createMcpHandler, handleMcpRequest } from '../src/mcp.js';

const MUTATING_TOOL_PATTERN = /post|follow|bookmark|dm/i;

type FakeClientOverrides = {
  search?: (query: string, count: number) => Promise<unknown>;
  getTweet?: (tweetId: string) => Promise<unknown>;
  getThread?: (tweetId: string) => Promise<unknown>;
  getReplies?: (tweetId: string) => Promise<unknown>;
};

function fakeClient(overrides: FakeClientOverrides = {}) {
  return {
    search: overrides.search ?? (async () => ({ success: true, tweets: [] })),
    getTweet: overrides.getTweet ?? (async () => ({ success: true, tweet: { id: '1' } })),
    getThread: overrides.getThread ?? (async () => ({ success: true, tweets: [] })),
    getReplies: overrides.getReplies ?? (async () => ({ success: true, tweets: [] })),
  };
}

describe('xbird MCP protocol', () => {
  it('supports modern server discovery', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(response?.result).toMatchObject({
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: {} },
    });
  });

  it('supports the legacy initialize handshake and rejects other versions', async () => {
    const handler = createMcpHandler();
    const response = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });

    expect(response?.result).toMatchObject({
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'xbird-mcp', version: '0.1.0' },
    });

    const unsupported = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    expect(unsupported?.error).toMatchObject({ code: -32602 });
  });

  it('lists only read-only tools', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list',
      params: {},
    });

    const result = response?.result as { tools?: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
    expect(result.tools?.map((tool) => tool.name)).toEqual(['x_search', 'x_read', 'x_thread', 'x_replies']);
    expect(result.tools?.some((tool) => MUTATING_TOOL_PATTERN.test(tool.name))).toBe(false);
    expect(result.tools?.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('accepts only numeric IDs and canonical X status URLs', async () => {
    const received: string[] = [];
    const handler = createMcpHandler({
      createClient: async () =>
        fakeClient({
          getTweet: async (tweetId) => {
            received.push(tweetId);
            return { success: true };
          },
        }),
    });

    await handler({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'x_read', arguments: { tweet: 'https://x.com/panda/status/123?ref=home' } },
    });
    await handler({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'x_read', arguments: { tweet: 'https://evil.example/x.com/panda/status/999' } },
    });

    expect(received).toEqual(['123']);
  });

  it('validates arguments before reading credentials or calling the client', async () => {
    let created = false;
    const handler = createMcpHandler({
      createClient: async () => {
        created = true;
        return fakeClient();
      },
    });

    const response = await handler({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'x_read', arguments: { tweet: 'not-a-tweet-id' } },
    });

    expect(created).toBe(false);
    expect(response?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(response)).toContain('numeric X post ID');
  });

  it('calls the injected read-only client with normalized arguments', async () => {
    let received: { query: string; count: number } | undefined;
    const handler = createMcpHandler({
      createClient: async () =>
        fakeClient({
          search: async (query, count) => {
            received = { query, count };
            return { success: true, tweets: [] };
          },
        }),
    });

    const response = await handler({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'x_search', arguments: { query: '  from:panda  ', count: 7 } },
    });

    expect(received).toEqual({ query: 'from:panda', count: 7 });
    const result = response?.result as { isError?: boolean } | undefined;
    expect(result?.isError).toBeUndefined();
    const content = result as { content?: Array<{ text?: string }> };
    expect(content.content?.[0]?.text).toContain('"success":true');
  });

  it('redacts credentials from tool data and errors', async () => {
    const authToken = 'auth-token-secret';
    const ct0 = 'csrf-token-secret';
    const cookieHeader = `auth_token=${authToken}; ct0=${ct0}`;
    const handler = createMcpHandler({
      secrets: [authToken, ct0, cookieHeader],
      createClient: async () =>
        fakeClient({
          getTweet: async () => ({ success: false, error: `upstream echoed ${cookieHeader}` }),
        }),
    });

    const response = await handler({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'x_read', arguments: { tweet: '123' } },
    });
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain(authToken);
    expect(serialized).not.toContain(ct0);
    expect(serialized).not.toContain(cookieHeader);
    expect(serialized).toContain('[REDACTED]');
    expect(response?.result).toMatchObject({ isError: true });
  });

  it('rejects unknown tools and unexpected arguments without invoking the client', async () => {
    let called = false;
    const handler = createMcpHandler({
      createClient: async () => {
        called = true;
        return fakeClient();
      },
    });

    const unknown = await handler({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'x_post', arguments: {} },
    });
    const extra = await handler({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'x_search', arguments: { query: 'x', shell: 'echo nope' } },
    });

    expect(called).toBe(false);
    expect(JSON.stringify(unknown)).toContain('Unknown tool');
    expect(JSON.stringify(extra)).toContain('unexpected property shell');
  });

  it('rejects malformed params and returns method-not-found for unsupported requests', async () => {
    const malformed = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/list',
      params: [],
    });
    expect(malformed?.error).toMatchObject({ code: -32602 });

    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'resources/list',
      params: {},
    });
    expect(response?.error).toMatchObject({ code: -32601 });
  });

  it('ignores notifications', async () => {
    const notification = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    });
    expect(notification).toBeNull();
  });
});
