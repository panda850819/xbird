import { describe, expect, it } from 'vitest';
import { handleMcpRequest } from '../src/mcp.js';

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
      supportedVersions: ['2026-07-28', '2025-11-25'],
      capabilities: { tools: {} },
    });
  });

  it('supports the legacy initialize handshake', async () => {
    const response = await handleMcpRequest({
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
  });

  it('lists only read-only tools', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    });

    const result = response?.result as { tools?: Array<{ name: string }> };
    expect(result.tools?.map((tool) => tool.name)).toEqual(['x_search', 'x_read', 'x_thread', 'x_replies']);
    expect(result.tools?.some((tool) => /post|follow|bookmark|dm/i.test(tool.name))).toBe(false);
  });

  it('ignores notifications', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    });

    expect(response).toBeNull();
  });

  it('returns method-not-found for unsupported requests', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/list',
      params: {},
    });

    expect(response?.error).toMatchObject({ code: -32601 });
  });
});
