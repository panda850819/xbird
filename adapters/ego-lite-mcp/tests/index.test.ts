import { describe, expect, it } from 'bun:test';
import { handleMcpRequest, scriptForTool } from '../src/index.ts';

describe('ego-lite-mcp', () => {
  it('discovers a constrained tool surface', async () => {
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (response?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);

    expect(tools).toContain('browser_snapshot');
    expect(tools).toContain('browser_fill');
    expect(tools).not.toContain('browser_js');
    expect(tools).not.toContain('browser_cdp');
    expect(tools).not.toContain('shell');
  });

  it('serializes user input instead of interpolating executable code', () => {
    const malicious = `'); process.exit(99); //`;
    const script = scriptForTool('browser_fill', {
      task: 'research',
      target: '@12',
      text: malicious,
    });

    expect(script).toContain(JSON.stringify(malicious));
    expect(script).toContain('fillInput');
    expect(script).not.toContain(`fillInput('@12', '${malicious}')`);
  });

  it('rejects non-http navigation', () => {
    expect(() => scriptForTool('browser_open', { url: 'file:///etc/passwd' })).toThrow(
      'only http:// and https:// URLs are allowed',
    );
  });

  it('prefixes task spaces to avoid colliding with normal Ego Lite spaces', () => {
    const script = scriptForTool('browser_snapshot', { task: 'pond-research' });
    expect(script).toContain('ego-lite-mcp:pond-research');
  });

  it('calls generated scripts through an injected runner', async () => {
    let captured = '';
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'browser_page_info', arguments: { task: 'test' } },
      },
      async (script) => {
        captured = script;
        return { url: 'https://example.com', title: 'Example' };
      },
    );

    expect(captured).toContain('pageInfo()');
    expect(JSON.stringify(response)).toContain('https://example.com');
  });
});
