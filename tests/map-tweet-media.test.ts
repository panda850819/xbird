import { describe, expect, it } from 'vitest';
import type { GraphqlTweetResult } from '../src/lib/twitter-client-types.js';
import { mapTweetResult } from '../src/lib/twitter-client-utils.js';

describe('mapTweetResult media', () => {
  const makeUserResult = () => ({
    core: {
      user_results: {
        result: {
          rest_id: 'u1',
          legacy: { screen_name: 'alice', name: 'Alice' },
        },
      },
    },
  });

  it('includes extracted media on mapped tweet', () => {
    const result: GraphqlTweetResult = {
      rest_id: '1',
      legacy: {
        full_text: 'hello',
        extended_entities: {
          media: [
            {
              type: 'photo',
              media_url_https: 'https://pbs.twimg.com/media/test.jpg',
              sizes: {
                large: { w: 800, h: 600, resize: 'fit' },
                small: { w: 320, h: 240, resize: 'fit' },
              },
            },
          ],
        },
      },
      ...makeUserResult(),
    };

    const mapped = mapTweetResult(result, 0);
    expect(mapped).toBeDefined();
    const media = mapped?.media ?? [];
    expect(media).toHaveLength(1);
    expect(media[0]).toEqual({
      type: 'photo',
      url: 'https://pbs.twimg.com/media/test.jpg',
      width: 800,
      height: 600,
      previewUrl: 'https://pbs.twimg.com/media/test.jpg:small',
    });
  });

  it('omits media when none present', () => {
    const result: GraphqlTweetResult = {
      rest_id: '2',
      legacy: { full_text: 'no media' },
      ...makeUserResult(),
    };

    const mapped = mapTweetResult(result, 0);
    expect(mapped?.media).toBeUndefined();
  });
});
