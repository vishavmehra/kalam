import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LAST_ROUTE_KEY, navigationType, readLastRoute, rememberRoute, restorablePath, routeToRestore } from './route-memory';

describe('route restore (D03-030)', () => {
  it('keeps screens that are safe to come back to and drops the query', () => {
    expect(restorablePath('/settings')).toBe('/settings');
    expect(restorablePath('/settings/')).toBe('/settings');
    expect(restorablePath('/app/abc-123/edit?draw=1')).toBe('/app/abc-123/edit');
    expect(restorablePath('/bazaar/library')).toBe('/bazaar/library');
    expect(restorablePath('/bazaar/listing_42')).toBe('/bazaar/listing_42');
    expect(restorablePath('/create/draw')).toBe('/create/draw');
  });

  it('refuses one-off, session-bound and unknown screens', () => {
    for (const p of ['/', '/onboarding', '/create/review', '/join', '/import', '/lab', '/nano-check', '/bazaar/publish', '/bazaar/moderation', '/app', '/a/b/c', '/settings/../x', null, undefined, '']) {
      expect(restorablePath(p as string), String(p)).toBeNull();
    }
    expect(restorablePath(`/app/${'x'.repeat(300)}`)).toBeNull();
  });

  it('restores only from the shelf address', () => {
    expect(routeToRestore({ pathname: '/', saved: '/settings', navType: 'reload' })).toBe('/settings');
    expect(routeToRestore({ pathname: '/', saved: '/settings', navType: 'back_forward' })).toBe('/settings');
    expect(routeToRestore({ pathname: '/bazaar', saved: '/settings', navType: 'reload' })).toBeNull();
    expect(routeToRestore({ pathname: '/', saved: '/create/review', navType: 'reload' })).toBeNull();
    expect(routeToRestore({ pathname: '/', saved: null, navType: 'reload' })).toBeNull();
  });

  it('opens the shelf for a typed address or a link, and when the load type is unknown', () => {
    for (const navType of ['navigate', 'prerender', undefined]) expect(routeToRestore({ pathname: '/', saved: '/settings', navType }), String(navType)).toBeNull();
  });

  it('reads the load type without throwing where there is no browser', () => {
    expect(() => navigationType()).not.toThrow();
  });

  describe('storage', () => {
    const mem = new Map<string, string>();
    beforeEach(() => {
      mem.clear();
      vi.stubGlobal('sessionStorage', {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      });
    });

    it('saves a screen, ignores a one-off one, and the shelf clears it', () => {
      rememberRoute('/settings');
      expect(readLastRoute()).toBe('/settings');
      rememberRoute('/create/review');
      expect(mem.get(LAST_ROUTE_KEY)).toBe('/settings');
      rememberRoute('/');
      expect(readLastRoute()).toBeNull();
    });

    it('never throws when storage is blocked', () => {
      const blocked = () => { throw new Error('blocked'); };
      vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
      expect(readLastRoute()).toBeNull();
      expect(() => rememberRoute('/settings')).not.toThrow();
    });
  });
});
