import { describe, expect, it } from 'vitest';
import { createCliContext } from '../src/cli/shared.js';
import {
  formatStatsLine,
  formatTweetUrlLine,
  hyperlink,
  labelPrefix,
  resolveOutputConfigFromArgv,
  resolveOutputConfigFromCommander,
  statusPrefix,
} from '../src/lib/output.js';
import type { TweetData } from '../src/lib/twitter-client-types.js';

describe('output', () => {
  it('defaults to emoji + color + hyperlinks on TTY', () => {
    const cfg = resolveOutputConfigFromArgv([], {}, true);
    expect(cfg).toEqual({ plain: false, emoji: true, color: true, hyperlinks: true });
  });

  it('disables hyperlinks on non-TTY', () => {
    const cfg = resolveOutputConfigFromArgv([], {}, false);
    expect(cfg.hyperlinks).toBe(false);
  });

  it('plain disables emoji + color + hyperlinks', () => {
    const cfg = resolveOutputConfigFromArgv(['--plain'], {}, true);
    expect(cfg).toEqual({ plain: true, emoji: false, color: false, hyperlinks: false });
    expect(statusPrefix('ok', cfg)).toBe('[ok] ');
    expect(labelPrefix('url', cfg)).toBe('url: ');
  });

  it('NO_COLOR disables colors by default', () => {
    const cfg = resolveOutputConfigFromArgv([], { NO_COLOR: '1' }, true);
    expect(cfg.color).toBe(false);
  });

  it('TERM=dumb disables colors by default', () => {
    const cfg = resolveOutputConfigFromArgv([], { TERM: 'dumb' }, true);
    expect(cfg.color).toBe(false);
  });

  it('--no-color disables colors', () => {
    const cfg = resolveOutputConfigFromArgv(['--no-color'], {}, true);
    expect(cfg).toEqual({ plain: false, emoji: true, color: false, hyperlinks: true });
  });

  it('--no-emoji switches to text prefixes', () => {
    const cfg = resolveOutputConfigFromArgv(['--no-emoji'], {}, true);
    expect(cfg.emoji).toBe(false);
    expect(statusPrefix('warn', cfg)).toBe('Warning: ');
  });

  it('commander opts override defaults', () => {
    const cfg = resolveOutputConfigFromCommander({ emoji: false, color: false }, {}, true);
    expect(cfg).toEqual({ plain: false, emoji: false, color: false, hyperlinks: true });
    expect(statusPrefix('info', cfg)).toBe('Info: ');
    expect(labelPrefix('date', cfg)).toBe('Date: ');
  });

  it('commander plain wins over emoji/color', () => {
    const cfg = resolveOutputConfigFromCommander({ plain: true, emoji: true, color: true }, {}, true);
    expect(cfg).toEqual({ plain: true, emoji: false, color: false, hyperlinks: false });
  });

  it('commander disables hyperlinks on non-TTY', () => {
    const cfg = resolveOutputConfigFromCommander({}, {}, false);
    expect(cfg.hyperlinks).toBe(false);
  });

  it('formats stats line for all modes', () => {
    const stats = { likeCount: null, retweetCount: undefined, replyCount: 2 };

    expect(formatStatsLine(stats, { plain: true, emoji: false, color: false, hyperlinks: false })).toBe(
      'likes: 0  retweets: 0  replies: 2',
    );
    expect(formatStatsLine(stats, { plain: false, emoji: false, color: false, hyperlinks: false })).toBe(
      'Likes 0  Retweets 0  Replies 2',
    );
    expect(formatStatsLine(stats, { plain: false, emoji: true, color: false, hyperlinks: false })).toBe(
      '❤️ 0  🔁 0  💬 2',
    );
  });

  it('always includes tweet URL in all modes', () => {
    const id = '1234567890';
    const url = `https://x.com/i/status/${id}`;

    expect(formatTweetUrlLine(id, { plain: true, emoji: false, color: false, hyperlinks: false })).toContain(url);
    expect(formatTweetUrlLine(id, { plain: false, emoji: false, color: false, hyperlinks: false })).toContain(url);
    expect(formatTweetUrlLine(id, { plain: false, emoji: true, color: false, hyperlinks: true })).toContain(url);
  });

  it('hyperlink returns plain text when hyperlinks disabled', () => {
    const cfg = { plain: true, emoji: false, color: false, hyperlinks: false };
    expect(hyperlink('https://x.com/test', undefined, cfg)).toBe('https://x.com/test');
  });

  it('hyperlink returns plain text on non-TTY (hyperlinks: false)', () => {
    const cfg = { plain: false, emoji: true, color: false, hyperlinks: false };
    expect(hyperlink('https://x.com/test', undefined, cfg)).toBe('https://x.com/test');
  });

  it('hyperlink wraps URL with OSC 8 escapes when hyperlinks enabled', () => {
    const cfg = { plain: false, emoji: true, color: true, hyperlinks: true };
    const result = hyperlink('https://x.com/test', undefined, cfg);
    expect(result).toContain('\x1b]8;;');
    expect(result).toContain('\x07');
  });

  it('hyperlink uses custom display text', () => {
    const cfg = { plain: false, emoji: true, color: true, hyperlinks: true };
    const result = hyperlink('https://x.com/test', 'Click here', cfg);
    expect(result).toContain('Click here');
    expect(result).toContain('\x1b]8;;https://x.com/test\x07');
  });

  it('hyperlink strips OSC control characters from url and text', () => {
    const cfg = { plain: false, emoji: true, color: true, hyperlinks: true };
    const result = hyperlink('https://x.com/\u001btest\u0007', 'Hi\u001b\u0007', cfg);
    expect(result).not.toContain('\u001btest\u0007');
    expect(result).not.toContain('Hi\u001b\u0007');
  });

  it('printTweets respects emoji toggle for media/article/quotes', () => {
    const tweet: TweetData = {
      id: '1',
      text: 'hello world',
      author: { username: 'alice', name: 'Alice' },
      media: [{ type: 'photo', url: 'https://img/test.jpg' }],
      article: { title: 'Article title', previewText: 'Preview' },
      quotedTweet: {
        id: '2',
        text: 'quoted text',
        author: { username: 'bob', name: 'Bob' },
        media: [{ type: 'video', url: 'https://vid/test.mp4' }],
      },
    };

    const ctxEmoji = createCliContext([], {}, true);
    const logEmoji = vi.spyOn(console, 'log').mockImplementation(() => {});
    ctxEmoji.printTweets([tweet]);
    const emojiOutput = logEmoji.mock.calls.flat().join('\n');
    logEmoji.mockRestore();

    expect(emojiOutput).toContain('📰 Article title');
    expect(emojiOutput).toContain('🖼️ https://img/test.jpg');
    expect(emojiOutput).toContain('┌─ QT @bob:');
    expect(emojiOutput).toContain('🎬 https://vid/test.mp4');

    const ctxPlain = createCliContext(['--plain'], {}, true);
    const logPlain = vi.spyOn(console, 'log').mockImplementation(() => {});
    ctxPlain.printTweets([tweet]);
    const plainOutput = logPlain.mock.calls.flat().join('\n');
    logPlain.mockRestore();

    expect(plainOutput).toContain('Article: Article title');
    expect(plainOutput).toContain('PHOTO: https://img/test.jpg');
    expect(plainOutput).toContain('QT @bob:');
    expect(plainOutput).toContain('VIDEO: https://vid/test.mp4');
    expect(plainOutput).not.toContain('📰');
    expect(plainOutput).not.toContain('🖼️');
  });
});
