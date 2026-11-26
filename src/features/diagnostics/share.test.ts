/**
 * The device binding in share.ts, with the share sheet and the clipboard replaced. Web resolves
 * `Share.share` with nothing once the share is done; that must count as shared, and must not copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const share = vi.fn();
const setStringAsync = vi.fn();

vi.mock('react-native', () => ({ Share: { share: (...args: unknown[]) => share(...args), dismissedAction: 'dismissedAction', sharedAction: 'sharedAction' } }));
vi.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => setStringAsync(...args) }));

import { copyText, shareText } from './share';

beforeEach(() => {
  share.mockReset();
  setStringAsync.mockReset().mockResolvedValue(true);
});

describe('shareText on the device', () => {
  it('counts a browser share that resolves with nothing as shared, and does not touch the clipboard', async () => {
    share.mockResolvedValue(undefined);
    expect(await shareText('report', 'Kalam problem report')).toBe('shared');
    expect(setStringAsync).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith({ message: 'report', title: 'Kalam problem report' }, { dialogTitle: 'Kalam problem report' });
  });

  it('counts a shared action as shared and a dismissed action as cancelled', async () => {
    share.mockResolvedValueOnce({ action: 'sharedAction' });
    expect(await shareText('report', 'title')).toBe('shared');
    share.mockResolvedValueOnce({ action: 'dismissedAction' });
    expect(await shareText('report', 'title')).toBe('cancelled');
    expect(setStringAsync).not.toHaveBeenCalled();
  });

  it('treats a closed browser share sheet (AbortError) as cancelled, without copying', async () => {
    share.mockRejectedValue(Object.assign(new Error('Share canceled'), { name: 'AbortError' }));
    expect(await shareText('report', 'title')).toBe('cancelled');
    expect(setStringAsync).not.toHaveBeenCalled();
  });

  it('copies when the browser has no share sheet or will not open it', async () => {
    share.mockRejectedValueOnce(new Error('Share is not supported in this browser'));
    expect(await shareText('report', 'title')).toBe('copied');
    share.mockRejectedValueOnce(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
    expect(await shareText('report', 'title')).toBe('copied');
    expect(setStringAsync).toHaveBeenCalledTimes(2);
    expect(setStringAsync).toHaveBeenCalledWith('report');
  });

  it('reports a failed copy when there is no share sheet and the clipboard refuses', async () => {
    share.mockRejectedValue(new Error('Share is not supported in this browser'));
    setStringAsync.mockResolvedValue(false);
    expect(await shareText('report', 'title')).toBe('failed');
  });
});

describe('copyText on the device', () => {
  it('copies, and says so when the clipboard refuses', async () => {
    expect(await copyText('report')).toBe('copied');
    setStringAsync.mockRejectedValue(new Error('denied'));
    expect(await copyText('report')).toBe('failed');
    expect(share).not.toHaveBeenCalled();
  });
});
