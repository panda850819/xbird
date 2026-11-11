import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRuntimeQueryIdStore,
  extractBundleUrls,
  fetchTwitterOpenApiQueryIds,
  TWITTER_OPENAPI_LABEL,
  TWITTER_OPENAPI_PLACEHOLDER_URL,
} from '../src/lib/runtime-query-ids.js';

describe('runtime-query-ids', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.XBIRD_QUERY_IDS_CACHE;
  });

  it('refreshes IDs by scanning discovered bundles and persists cache', async () => {
    const cacheDir = path.join(os.tmpdir(), `xbird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids.json');

    const html = `
      <html>
        <script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>
      </html>
    `;
    const js = [
      `e.exports={queryId:"AAA",operationName:"CreateTweet"}`,
      `e.exports={queryId:"BBB",operationName:"CreateRetweet"}`,
      `e.exports={queryId:"CCC",operationName:"FavoriteTweet"}`,
      `e.exports={queryId:"DDD",operationName:"TweetDetail"}`,
      `e.exports={queryId:"EEE",operationName:"SearchTimeline"}`,
      `e.exports={queryId:"FFF",operationName:"UserArticlesTweets"}`,
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL) => {
      const asString = String(url);
      if (asString.startsWith('https://x.com/')) {
        return new Response(html, { status: 200 });
      }
      if (asString.startsWith('https://abs.twimg.com/')) {
        return new Response(js, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const store = createRuntimeQueryIdStore({
      cachePath,
      ttlMs: 1000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const info = await store.refresh(
      ['CreateTweet', 'CreateRetweet', 'FavoriteTweet', 'TweetDetail', 'SearchTimeline', 'UserArticlesTweets'],
      { force: true },
    );

    expect(info?.snapshot.ids.CreateTweet).toBe('AAA');
    expect(info?.snapshot.ids.TweetDetail).toBe('DDD');
    expect(info?.cachePath).toBe(cachePath);

    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as { ids?: Record<string, string> };
    expect(parsed.ids?.SearchTimeline).toBe('EEE');
  });

  it('uses env cache path override and returns fresh snapshot without refreshing', async () => {
    const cacheDir = path.join(os.tmpdir(), `xbird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids-cache.json');
    process.env.XBIRD_QUERY_IDS_CACHE = cachePath;

    const snapshot = {
      fetchedAt: new Date().toISOString(),
      ttlMs: 60_000,
      ids: { CreateTweet: 'AAA' },
      discovery: { pages: ['https://x.com/'], bundles: ['main.js'] },
    };
    await writeFile(cachePath, JSON.stringify(snapshot), 'utf8');

    const fetchMock = vi.fn();
    const store = createRuntimeQueryIdStore({ fetchImpl: fetchMock as unknown as typeof fetch });
    const info = await store.refresh(['CreateTweet']);

    expect(store.cachePath).toBe(cachePath);
    expect(info?.snapshot.ids.CreateTweet).toBe('AAA');
    expect(fetchMock).not.toHaveBeenCalled();

    store.clearMemory();
  });

  it('returns current snapshot when refresh finds no matching operations', async () => {
    const cacheDir = path.join(os.tmpdir(), `xbird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids.json');

    const snapshot = {
      fetchedAt: new Date(0).toISOString(),
      ttlMs: 1,
      ids: { CreateTweet: 'AAA' },
      discovery: { pages: ['https://x.com/'], bundles: ['main.test.js'] },
    };
    await writeFile(cachePath, JSON.stringify(snapshot), 'utf8');

    const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>`;
    const js = 'console.log("no ops here")';

    const fetchMock = vi.fn(async (url: string | URL) => {
      const asString = String(url);
      if (asString.startsWith('https://x.com/')) {
        return new Response(html, { status: 200 });
      }
      if (asString.startsWith('https://abs.twimg.com/')) {
        return new Response(js, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const store = createRuntimeQueryIdStore({
      cachePath,
      ttlMs: 1,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const info = await store.refresh(['CreateTweet']);
    expect(info?.snapshot.ids.CreateTweet).toBe('AAA');
  });

  it('extracts x-web entry-client bundles alongside legacy client-web bundles', () => {
    const html = `
      <script type="module" src="https://abs.twimg.com/x-web/x-web/entry-client-logged-out-CXOnk7a0.js"></script>
      <script src="https://abs.twimg.com/x-web/x-web/entry-client-Ab_c9.js"></script>
      <script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>
    `;
    expect(extractBundleUrls(html)).toEqual([
      'https://abs.twimg.com/x-web/x-web/entry-client-logged-out-CXOnk7a0.js',
      'https://abs.twimg.com/x-web/x-web/entry-client-Ab_c9.js',
      'https://abs.twimg.com/responsive-web/client-web/main.test.js',
    ]);
  });

  it('scans x-web entry-client bundles during refresh', async () => {
    const cacheDir = path.join(os.tmpdir(), `xbird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids.json');
    const entryUrl = 'https://abs.twimg.com/x-web/x-web/entry-client-Xw1.js';
    const html = `<script type="module" src="${entryUrl}"></script>`;

    const fetchMock = vi.fn(async (url: string | URL) => {
      const asString = String(url);
      if (asString.startsWith('https://x.com/')) {
        return new Response(html, { status: 200 });
      }
      if (asString === entryUrl) {
        return new Response(`e.exports={queryId:"XWEB1",operationName:"SearchTimeline"}`, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const store = createRuntimeQueryIdStore({ cachePath, fetchImpl: fetchMock as unknown as typeof fetch });
    const info = await store.refresh(['SearchTimeline'], { force: true });

    expect(info?.snapshot.ids.SearchTimeline).toBe('XWEB1');
    expect(info?.snapshot.discovery.bundles).toEqual(['entry-client-Xw1.js']);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain(entryUrl);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain(TWITTER_OPENAPI_PLACEHOLDER_URL);
  });

  it('fills SearchTimeline from twitter-openapi when bundles do not expose it', async () => {
    const cacheDir = path.join(os.tmpdir(), `xbird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids.json');
    const entryUrl = 'https://abs.twimg.com/x-web/x-web/entry-client-Xw2.js';
    const placeholder = {
      SearchTimeline: { queryId: 'OPENAPI_SEARCH' },
      UserTweets: { queryId: 'OPENAPI_USER_TWEETS' },
    };

    const fetchMock = vi.fn(async (url: string | URL) => {
      const asString = String(url);
      if (asString.startsWith('https://x.com/')) {
        return new Response(`<script src="${entryUrl}"></script>`, { status: 200 });
      }
      if (asString === entryUrl) {
        return new Response('params:{id:`relay`,metadata:{},name:`SearchByRawQuery`}', { status: 200 });
      }
      if (asString === TWITTER_OPENAPI_PLACEHOLDER_URL) {
        return new Response(JSON.stringify(placeholder), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const store = createRuntimeQueryIdStore({ cachePath, fetchImpl: fetchMock as unknown as typeof fetch });
    const info = await store.refresh(['SearchTimeline', 'UserTweets'], { force: true });

    expect(info?.snapshot.ids).toEqual({ SearchTimeline: 'OPENAPI_SEARCH' });
    expect(info?.snapshot.discovery.bundles).toEqual(['entry-client-Xw2.js', TWITTER_OPENAPI_LABEL]);
  });

  it('returns no twitter-openapi IDs when the placeholder fetch fails or is malformed', async () => {
    const failing = vi.fn(async () => new Response('boom', { status: 503 }));
    expect((await fetchTwitterOpenApiQueryIds(failing as unknown as typeof fetch, ['SearchTimeline'])).size).toBe(0);

    const malformed = vi.fn(async () => new Response('{not json', { status: 200 }));
    expect((await fetchTwitterOpenApiQueryIds(malformed as unknown as typeof fetch, ['SearchTimeline'])).size).toBe(0);

    const unlisted = vi.fn();
    expect((await fetchTwitterOpenApiQueryIds(unlisted as unknown as typeof fetch, ['UserTweets'])).size).toBe(0);
    expect(unlisted).not.toHaveBeenCalled();
  });

  it('throws when no bundles can be discovered', async () => {
    const cacheDir = path.join(os.tmpdir(), `xbird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids.json');

    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));

    const store = createRuntimeQueryIdStore({
      cachePath,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(store.refresh(['CreateTweet'], { force: true })).rejects.toThrow(
      'No client bundles discovered; x.com layout may have changed.',
    );
  });
});
