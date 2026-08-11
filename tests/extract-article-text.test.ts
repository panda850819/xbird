import { describe, expect, it } from 'vitest';
import type { GraphqlTweetResult } from '../src/lib/twitter-client-types.js';
import { extractArticleText } from '../src/lib/twitter-client-utils.js';

describe('extractArticleText', () => {
  it('does not duplicate title when rich content starts with a heading', () => {
    const result = {
      rest_id: '1',
      article: {
        title: 'Hello World',
        article_results: {
          result: {
            title: 'Hello World',
            content_state: {
              blocks: [
                {
                  key: '1',
                  type: 'header-one',
                  text: 'Hello World',
                  entityRanges: [],
                  inlineStyleRanges: [],
                },
              ],
              entityMap: [],
            },
          },
        },
      },
    } as GraphqlTweetResult;

    expect(extractArticleText(result)).toBe('# Hello World');
  });
});
