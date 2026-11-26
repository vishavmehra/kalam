import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';

/**
 * Owner, 2026-11-25: signing in is required to use Kalam, so no text may say or hint that an account is optional,
 * and there is no guest. This guards the English catalogue; the other nine catalogues are checked by the
 * parity test once they are filled from it.
 */
const strings = (node: unknown, path = ''): Array<[string, string]> =>
  typeof node === 'string' ? [[path, node]]
    : node && typeof node === 'object' ? Object.entries(node).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
      : [];

const BANNED = [
  /do not need an account/i,
  /no account (is )?(needed|required)/i,
  /without an account/i,
  /without one\b/i,
  /accounts? (is|are) optional/i,
  /\bguests?\b/i,
];

describe('English catalogue and the required sign-in', () => {
  it('never promises that Kalam works without an account, and never mentions a guest', () => {
    const hits = strings(en).filter(([, text]) => BANNED.some((re) => re.test(text))).map(([key, text]) => `${key}: ${text}`);
    expect(hits).toEqual([]);
  });

  it('has the sign-in screen texts', () => {
    const keys = new Map(strings(en));
    for (const key of ['auth.gate.title', 'auth.gate.lede', 'auth.gate.checking', 'auth.gate.offline', 'auth.sheet.privacy', 'account.signOutConfirm.message', 'bazaar.unreachable.title']) {
      expect(keys.get(key), key).toBeTruthy();
    }
  });
});
