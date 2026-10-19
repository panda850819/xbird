import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import type { GraphqlReadOptions, GraphqlReadRequest, GraphqlReadResponse } from '../src/lib/twitter-client-base.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

type GraphqlReader = {
  fetchGraphqlRead(request: GraphqlReadRequest, options?: GraphqlReadOptions): Promise<GraphqlReadResponse>;
};

const code32 = () => ({
  ok: false,
  status: 401,
  headers: new Headers(),
  text: async () => JSON.stringify({ errors: [{ message: 'Could not authenticate you', code: 32 }] }),
});

const failure = (status: number, body: string) => ({
  ok: false,
  status,
  headers: new Headers(),
  text: async () => body,
});

const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

const request: GraphqlReadRequest = {
  queryId: 'qid',
  operation: 'Following',
  variables: { userId: '1', count: 20 },
  features: { flag: true },
  fieldToggles: { toggle: false },
};

function expectGetThenPost(mockFetch: ReturnType<typeof vi.fn>, operation: string) {
  expect(mockFetch).toHaveBeenCalledTimes(2);
  const [getUrl, getInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const [postUrl, postInit] = mockFetch.mock.calls[1] as [string, RequestInit];
  expect(getInit.method).toBe('GET');
  expect(getUrl).toContain(`/${operation}?`);
  expect(postInit.method).toBe('POST');
  expect(postUrl).toMatch(new RegExp(`/${operation}$`));
  const body = JSON.parse(postInit.body as string);
  expect(body.variables).toBeTypeOf('object');
  expect(body.features).toBeTypeOf('object');
  expect(body.queryId).toBeTypeOf('string');
  return body as Record<string, unknown>;
}

describe('fetchGraphqlRead', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let reader: GraphqlReader;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    reader = new TwitterClient({ cookies: validCookies }) as unknown as GraphqlReader;
  });

  it('returns a successful GET without sending POST', async () => {
    mockFetch.mockResolvedValueOnce(ok({ data: {} }));

    const result = await reader.fetchGraphqlRead(request);

    expect(result.response.ok).toBe(true);
    expect(result.getError).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    const params = new URL(url).searchParams;
    expect(JSON.parse(params.get('variables') ?? '')).toEqual(request.variables);
    expect(JSON.parse(params.get('features') ?? '')).toEqual(request.features);
    expect(JSON.parse(params.get('fieldToggles') ?? '')).toEqual(request.fieldToggles);
  });

  it('retries as POST with the payload in the body when GET returns 401 code 32', async () => {
    mockFetch.mockResolvedValueOnce(code32()).mockResolvedValueOnce(ok({ data: {} }));

    const result = await reader.fetchGraphqlRead(request);

    expect(result.response.ok).toBe(true);
    expect(result.getError).toBe('GET HTTP 401 (code 32)');
    const body = expectGetThenPost(mockFetch, 'Following');
    expect(body).toEqual({
      variables: request.variables,
      features: request.features,
      fieldToggles: request.fieldToggles,
      queryId: 'qid',
    });
  });

  it('omits fieldToggles from GET and POST when the request has none', async () => {
    mockFetch.mockResolvedValueOnce(code32()).mockResolvedValueOnce(ok({ data: {} }));

    await reader.fetchGraphqlRead({ ...request, fieldToggles: undefined });

    expect(new URL(mockFetch.mock.calls[0]?.[0] as string).searchParams.has('fieldToggles')).toBe(false);
    expect(JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body))).not.toHaveProperty('fieldToggles');
  });

  it.each([
    ['404', failure(404, 'Not found')],
    ['500', failure(500, 'Server error')],
    ['429', failure(429, 'Rate limited')],
    ['401 with another error code', failure(401, JSON.stringify({ errors: [{ code: 89 }] }))],
    ['401 with a non-JSON body', failure(401, 'Unauthorized')],
  ])('does not retry GET %s as POST', async (_label, response) => {
    mockFetch.mockResolvedValueOnce(response);

    const result = await reader.fetchGraphqlRead(request);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.getError).toBeUndefined();
    expect(result.response.status).toBe(response.status);
    expect(await result.response.text()).toBe(await response.text());
  });

  it('retries GET 404 as POST only when postOn404 is set', async () => {
    mockFetch.mockResolvedValueOnce(failure(404, '')).mockResolvedValueOnce(ok({ data: {} }));

    const result = await reader.fetchGraphqlRead(request, { postOn404: true });

    expect(result.getError).toBe('GET HTTP 404');
    expectGetThenPost(mockFetch, 'Following');
  });
});

describe('GraphQL reads fall back to POST on 401 code 32', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  const tweet = {
    __typename: 'Tweet',
    rest_id: '100',
    legacy: {
      full_text: 'hello',
      created_at: 'Mon Jan 06 00:00:00 +0000 2025',
      reply_count: 0,
      retweet_count: 0,
      favorite_count: 0,
      conversation_id_str: '100',
    },
    core: { user_results: { result: { rest_id: 'u1', legacy: { screen_name: 'alice', name: 'Alice' } } } },
  };
  const tweetInstructions = [{ entries: [{ content: { itemContent: { tweet_results: { result: tweet } } } }] }];

  it.each([
    ['HomeTimeline', 'getHomeTimeline'],
    ['HomeLatestTimeline', 'getHomeLatestTimeline'],
  ] as const)('%s', async (operation, method) => {
    mockFetch
      .mockResolvedValueOnce(code32())
      .mockResolvedValueOnce(ok({ data: { home: { home_timeline_urt: { instructions: tweetInstructions } } } }));

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client[method](1);

    expect(result.success).toBe(true);
    expect(result.tweets?.[0]?.id).toBe('100');
    expectGetThenPost(mockFetch, operation);
  });

  it('Following', async () => {
    mockFetch.mockResolvedValueOnce(code32()).mockResolvedValueOnce(
      ok({
        data: {
          user: {
            result: {
              timeline: {
                timeline: {
                  instructions: [
                    {
                      type: 'TimelineAddEntries',
                      entries: [
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: {
                                  __typename: 'User',
                                  rest_id: '7',
                                  legacy: { screen_name: 'bob', name: 'Bob' },
                                },
                              },
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      }),
    );

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getFollowing('1', 20);

    expect(result.success).toBe(true);
    expect(result.users?.[0]?.id).toBe('7');
    expectGetThenPost(mockFetch, 'Following');
  });

  it('UserTweets', async () => {
    mockFetch
      .mockResolvedValueOnce(code32())
      .mockResolvedValueOnce(
        ok({ data: { user: { result: { timeline: { timeline: { instructions: tweetInstructions } } } } } }),
      );

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweets('1', 1);

    expect(result.success).toBe(true);
    expect(result.tweets?.[0]?.id).toBe('100');
    const body = expectGetThenPost(mockFetch, 'UserTweets');
    expect(body.fieldToggles).toBeDefined();
  });

  it('UserByScreenName', async () => {
    mockFetch.mockResolvedValueOnce(code32()).mockResolvedValueOnce(
      ok({
        data: {
          user: { result: { __typename: 'User', rest_id: '42', legacy: { screen_name: 'carol', name: 'Carol' } } },
        },
      }),
    );

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('carol');

    expect(result).toMatchObject({ success: true, userId: '42', username: 'carol' });
    const body = expectGetThenPost(mockFetch, 'UserByScreenName');
    expect(body.fieldToggles).toBeDefined();
  });

  it('reports both status codes without credentials when GET and POST both fail', async () => {
    mockFetch
      .mockResolvedValueOnce(code32())
      .mockResolvedValueOnce(failure(403, JSON.stringify({ errors: [{ message: 'Forbidden', code: 353 }] })));

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getFollowing('1', 20);

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 403 on POST fallback after GET HTTP 401 (code 32)');
    expect(result.error).not.toContain(validCookies.authToken);
    expect(result.error).not.toContain(validCookies.ct0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('reports both status codes for home timeline when GET and POST both fail', async () => {
    mockFetch.mockResolvedValueOnce(code32()).mockResolvedValueOnce(code32());

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getHomeTimeline(1);

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401 on POST fallback after GET HTTP 401 (code 32)');
    expect(result.error).not.toContain(validCookies.authToken);
    expect(result.error).not.toContain(validCookies.ct0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
