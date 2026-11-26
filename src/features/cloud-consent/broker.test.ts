import { afterEach, describe, expect, it, vi } from 'vitest';

import { answerCloudNotice, askCloudNotice, CLOUD_NOTICE_TIMEOUT_MS, isCloudNoticeOpen, subscribeCloudNotice } from './broker';

describe('cloud notice broker', () => {
  afterEach(() => vi.useRealTimers());

  it('refuses at once when no host is mounted, and does not call that a decline', async () => {
    expect(await askCloudNotice()).toBeUndefined();
    expect(isCloudNoticeOpen()).toBe(false);
  });

  it('opens for the host, shares one question, and resolves with the answer', async () => {
    let opened = 0;
    const off = subscribeCloudNotice(() => { if (isCloudNoticeOpen()) opened += 1; });
    const a = askCloudNotice();
    const b = askCloudNotice();
    expect(isCloudNoticeOpen()).toBe(true);
    expect(opened).toBe(1);
    answerCloudNotice(true);
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(isCloudNoticeOpen()).toBe(false);
    const c = askCloudNotice();
    answerCloudNotice(false);
    expect(await c).toBe(false);
    off();
  });

  it('closes a question left open when the host goes away, without a decline', async () => {
    const off = subscribeCloudNotice(() => {});
    const q = askCloudNotice();
    off();
    expect(await q).toBeUndefined();
    expect(isCloudNoticeOpen()).toBe(false);
  });

  it('gives up after a minute with no answer, without a decline', async () => {
    vi.useFakeTimers();
    const off = subscribeCloudNotice(() => {});
    const q = askCloudNotice();
    vi.advanceTimersByTime(CLOUD_NOTICE_TIMEOUT_MS - 1);
    expect(isCloudNoticeOpen()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await q).toBeUndefined();
    expect(isCloudNoticeOpen()).toBe(false);
    off();
  });

  it('ignores an answer when nothing is being asked', () => {
    expect(() => answerCloudNotice(true)).not.toThrow();
  });
});
