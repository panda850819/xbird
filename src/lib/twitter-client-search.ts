import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildSearchFeatures } from './twitter-client-features.js';
import type { SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

const RAW_QUERY_MISSING_REGEX = /must be defined/i;
const INTERNAL_SERVER_ERROR_REGEX = /internal server error/i;

/** Options for search methods */
export interface SearchFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
}

/** Options for paged search methods */
export interface SearchPaginationOptions extends SearchFetchOptions {
  maxPages?: number;
  /** Starting cursor for pagination (resume from previous fetch) */
  cursor?: string;
}

export interface TwitterClientSearchMethods {
  search(query: string, count?: number, options?: SearchFetchOptions): Promise<SearchResult>;
  getAllSearchResults(query: string, options?: SearchPaginationOptions): Promise<SearchResult>;
}

function isQueryIdMismatch(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as {
      errors?: Array<{ message?: string; path?: string[]; extensions?: { code?: string } }>;
    };
    return (
      parsed.errors?.some((error) => {
        if (error?.extensions?.code === 'GRAPHQL_VALIDATION_FAILED') {
          return true;
        }
        if (error?.path?.includes('rawQuery') && RAW_QUERY_MISSING_REGEX.test(error.message ?? '')) {
          return true;
        }
        return false;
      }) ?? false
    );
  } catch {
    return false;
  }
}

function isInternalServerError(status: number, payload: string): boolean {
  return status >= 500 || INTERNAL_SERVER_ERROR_REGEX.test(payload);
}

/**
 * Outcome of trying every SearchTimeline query ID once. `staleQueryId` means
 * at least one ID looked rotated or broken (404, validation mismatch, or
 * Internal server error), so a single query-ID refresh is worth attempting.
 */
type SearchPageAttempt =
  | { success: true; tweets: TweetData[]; cursor?: string }
  | { success: false; error: string; staleQueryId: boolean };

export function withSearch<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientSearchMethods> {
  abstract class TwitterClientSearch extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Search for tweets matching a query
     */
    async search(query: string, count = 20, options: SearchFetchOptions = {}): Promise<SearchResult> {
      return this.searchPaged(query, count, options);
    }

    /**
     * Get all search results (paged)
     */
    async getAllSearchResults(query: string, options?: SearchPaginationOptions): Promise<SearchResult> {
      return this.searchPaged(query, Number.POSITIVE_INFINITY, options);
    }

    private async searchPaged(
      query: string,
      limit: number,
      options: SearchPaginationOptions = {},
    ): Promise<SearchResult> {
      const features = buildSearchFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined = options.cursor;
      let nextCursor: string | undefined;
      let pagesFetched = 0;
      const { includeRaw = false, maxPages } = options;

      const fetchPage = async (pageCount: number, pageCursor?: string): Promise<SearchPageAttempt> => {
        let lastError: string | undefined;
        let staleQueryId = false;
        const queryIds = await this.getSearchTimelineQueryIds();

        for (const queryId of queryIds) {
          const variables = {
            rawQuery: query,
            count: pageCount,
            querySource: 'typed_query',
            product: 'Latest',
            withGrokTranslatedBio: true,
            withQuickPromoteEligibilityTweetFields: false,
            ...(pageCursor ? { cursor: pageCursor } : {}),
          };

          const params = new URLSearchParams({
            variables: JSON.stringify(variables),
          });

          const url = `${TWITTER_API_BASE}/${queryId}/SearchTimeline?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'POST',
              headers: this.getHeaders(),
              body: JSON.stringify({ features, queryId }),
            });

            if (response.status === 404) {
              staleQueryId = true;
              lastError = `HTTP ${response.status}`;
              continue;
            }

            if (!response.ok) {
              const text = await response.text();
              if (isInternalServerError(response.status, text)) {
                staleQueryId = true;
                lastError = this.formatHttpError(response, text);
                continue;
              }
              const shouldRefreshQueryIds =
                (response.status === 400 || response.status === 422) && isQueryIdMismatch(text);
              return {
                success: false,
                error: this.formatHttpError(response, text),
                staleQueryId: staleQueryId || shouldRefreshQueryIds,
              };
            }

            const data = (await response.json()) as {
              data?: {
                search_by_raw_query?: {
                  search_timeline?: {
                    timeline?: {
                      instructions?: Array<{
                        entries?: Array<{
                          content?: {
                            itemContent?: {
                              tweet_results?: {
                                result?: {
                                  rest_id?: string;
                                  legacy?: {
                                    full_text?: string;
                                    created_at?: string;
                                    reply_count?: number;
                                    retweet_count?: number;
                                    favorite_count?: number;
                                    in_reply_to_status_id_str?: string;
                                  };
                                  core?: {
                                    user_results?: {
                                      result?: {
                                        legacy?: {
                                          screen_name?: string;
                                          name?: string;
                                        };
                                      };
                                    };
                                  };
                                };
                              };
                            };
                          };
                        }>;
                      }>;
                    };
                  };
                };
              };
              errors?: Array<{ message: string; extensions?: { code?: string } }>;
            };

            if (data.errors && data.errors.length > 0) {
              const message = data.errors.map((e) => e.message).join(', ');
              if (INTERNAL_SERVER_ERROR_REGEX.test(message)) {
                staleQueryId = true;
                lastError = message;
                continue;
              }
              const shouldRefreshQueryIds = data.errors.some(
                (error) => error?.extensions?.code === 'GRAPHQL_VALIDATION_FAILED',
              );
              return {
                success: false,
                error: message,
                staleQueryId: staleQueryId || shouldRefreshQueryIds,
              };
            }

            const instructions = data.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
            const pageTweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });
            const nextCursor = extractCursorFromInstructions(instructions);

            return { success: true, tweets: pageTweets, cursor: nextCursor };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false, error: lastError ?? 'Unknown error fetching search results', staleQueryId };
      };

      const fetchWithRefresh = async (pageCount: number, pageCursor?: string): Promise<SearchPageAttempt> => {
        const firstAttempt = await fetchPage(pageCount, pageCursor);
        if (firstAttempt.success || !firstAttempt.staleQueryId) {
          return firstAttempt;
        }
        await this.refreshQueryIds();
        return fetchPage(pageCount, pageCursor);
      };

      const unlimited = limit === Number.POSITIVE_INFINITY;
      while (unlimited || tweets.length < limit) {
        const pageCount = unlimited ? pageSize : Math.min(pageSize, limit - tweets.length);
        const page = await fetchWithRefresh(pageCount, cursor);
        if (!page.success) {
          return { success: false, error: page.error };
        }
        pagesFetched += 1;

        let added = 0;
        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          added += 1;
          if (!unlimited && tweets.length >= limit) {
            break;
          }
        }

        const pageCursor = page.cursor;
        if (!pageCursor || pageCursor === cursor || page.tweets.length === 0 || added === 0) {
          nextCursor = undefined;
          break;
        }
        if (maxPages && pagesFetched >= maxPages) {
          nextCursor = pageCursor;
          break;
        }
        cursor = pageCursor;
        nextCursor = pageCursor;
      }

      return { success: true, tweets, nextCursor };
    }
  }

  return TwitterClientSearch;
}
