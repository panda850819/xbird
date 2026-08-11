import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient getUserIdByUsername', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('resolves username to userId via GraphQL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user: {
            result: {
              __typename: 'User',
              rest_id: '12345',
              legacy: {
                screen_name: 'testuser',
                name: 'Test User',
              },
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('@testuser');

    expect(result.success).toBe(true);
    expect(result.userId).toBe('12345');
    expect(result.username).toBe('testuser');
    expect(result.name).toBe('Test User');
  });

  it('handles username without @ prefix', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user: {
            result: {
              __typename: 'User',
              rest_id: '67890',
              legacy: {
                screen_name: 'anotheruser',
                name: 'Another User',
              },
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('anotheruser');

    expect(result.success).toBe(true);
    expect(result.userId).toBe('67890');
  });

  it('returns error for invalid username format', async () => {
    const client = new TwitterClient({ cookies: validCookies });

    const result = await client.getUserIdByUsername('invalid handle with spaces');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid username');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error for empty username', async () => {
    const client = new TwitterClient({ cookies: validCookies });

    const result = await client.getUserIdByUsername('');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid username');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error for username exceeding 15 characters', async () => {
    const client = new TwitterClient({ cookies: validCookies });

    const result = await client.getUserIdByUsername('thisusernameiswaytoolong');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid username');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error when user is unavailable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user: {
            result: {
              __typename: 'UserUnavailable',
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('suspended');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or unavailable');
  });

  it('retries with fallback query IDs on 404', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                __typename: 'User',
                rest_id: '99999',
                legacy: {
                  screen_name: 'founduser',
                  name: 'Found User',
                },
              },
            },
          },
        }),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('founduser');

    expect(result.success).toBe(true);
    expect(result.userId).toBe('99999');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
