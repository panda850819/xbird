# xbird TypeScript library reference

## Install and import

```bash
bun add github:panda850819/xbird
```

```ts
import {
  TwitterClient,
  resolveCredentials,
  type SearchResult,
  type TweetData,
} from '@panda850819/xbird';
```

## Credentials and client lifetime

```ts
const { cookies, warnings } = await resolveCredentials({
  cookieSource: ['safari', 'chrome', 'arc', 'firefox'],
  chromeProfile: 'Default',
  firefoxProfile: 'default-release',
  cookieTimeoutMs: 30_000,
});

if (!cookies.authToken || !cookies.ct0) {
  throw new Error(warnings.join('; '));
}

const client = new TwitterClient({
  cookies,
  timeoutMs: 20_000,
  quoteDepth: 1,
});
```

`resolveCredentials` also reads `AUTH_TOKEN` and `CT0`, with `TWITTER_AUTH_TOKEN` and `TWITTER_CT0` as fallbacks. Never serialize or log the returned cookies.

Construct one client per credential set and reuse it. `TwitterClient` throws when either required cookie is missing.

## Result handling

Most read methods return a discriminated result. Check `success` first:

```ts
const result = await client.getTweet('1234567890123456789');
if (!result.success || !result.tweet) {
  throw new Error(result.error ?? 'Post not found');
}
console.log(result.tweet.text);
```

`SearchResult` has this shape:

```ts
type SearchResult =
  | { success: true; tweets: TweetData[]; nextCursor?: string }
  | { success: false; error: string; tweets?: TweetData[]; nextCursor?: string };
```

Do not assume an empty array means failure. Do not assume a resolved promise means `success: true`.

## Common read methods

```ts
client.getTweet(tweetId, { includeRaw?: boolean })
client.getReplies(tweetId, { includeRaw?: boolean })
client.getThread(tweetId, { includeRaw?: boolean })
client.search(query, count, { includeRaw?: boolean })
client.getHomeTimeline(count, { includeRaw?: boolean })
client.getHomeLatestTimeline(count, { includeRaw?: boolean })
client.getBookmarks(count, { includeRaw?: boolean })
client.getLikes(count, { includeRaw?: boolean })
client.getOwnedLists(count)
client.getListMemberships(count)
client.getListTimeline(listId, count, { includeRaw?: boolean })
client.getCurrentUser()
client.getFollowing(userId, count, cursor)
client.getFollowers(userId, count, cursor)
client.getUserTweets(userId, count, { includeRaw?: boolean })
client.getNews(count, { aiOnly, withTweets, tweetsPerItem, tabs, includeRaw })
```

Use `getUserIdByUsername(handle)` before `getUserTweets`, `getFollowing`, or `getFollowers` when only a handle is available.

## Bounded pagination

Prefer bounded pagination:

```ts
const result = await client.getAllSearchResults('from:example', {
  maxPages: 3,
});

const replies = await client.getRepliesPaged(tweetId, {
  maxPages: 3,
  pageDelayMs: 1_000,
});

const timeline = await client.getUserTweetsPaged(userId, 100, {
  maxPages: 5,
  pageDelayMs: 1_000,
});
```

Other paged methods include:

```ts
client.getThreadPaged(tweetId, { maxPages, cursor, pageDelayMs })
client.getAllBookmarks({ maxPages, cursor })
client.getAllLikes({ maxPages, cursor })
client.getAllListTimeline(listId, { maxPages, cursor })
client.getAllBookmarkFolderTimeline(folderId, { maxPages, cursor })
```

Persist `nextCursor` only when implementing resumable jobs. Stop on repeated cursors, API errors, or rate limits.

## Mutations

Posting returns `TweetResult`; unbookmarking returns `BookmarkMutationResult`. Check `success` explicitly:

```ts
const posted = await client.tweet('hello from xbird');
if (!posted.success) {
  throw new Error(posted.error);
}
console.log(posted.tweetId);

const replied = await client.reply('thanks', replyToTweetId);
if (!replied.success) {
  throw new Error(replied.error);
}

const removed = await client.unbookmark(tweetId);
if (!removed.success) {
  throw new Error(removed.error);
}
```

These calls mutate external state. Agents should only invoke them after explicit user intent.

## Media upload

Upload media first, then pass its ID to `tweet` or `reply`:

```ts
const file = Bun.file('./image.png');
const uploaded = await client.uploadMedia({
  data: new Uint8Array(await file.arrayBuffer()),
  mimeType: file.type || 'image/png',
  alt: 'Accessible image description',
});

if (!uploaded.success || !uploaded.mediaId) {
  throw new Error(uploaded.error ?? 'Media upload failed');
}

const posted = await client.tweet('caption', [uploaded.mediaId]);
if (!posted.success) {
  throw new Error(posted.error);
}
```

Use up to four images or one video. Supply useful alt text for images.

## Query-ID recovery

The client normally refreshes rotating GraphQL query IDs automatically. For an explicit refresh:

```ts
import { runtimeQueryIds } from '@panda850819/xbird';

await runtimeQueryIds.refresh(['TweetDetail', 'SearchTimeline'], { force: true });
```

Refresh once after a likely query-ID mismatch. Repeated refresh loops will not fix authentication, permission, or rate-limit failures.
