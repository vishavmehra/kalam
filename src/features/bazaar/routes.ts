import type { Href } from 'expo-router';

/** Bazaar sub-routes (the shell owns `/bazaar` itself). Cast: typed routes are generated at dev start. */
export const bazaarRoutes = {
  home: '/bazaar' as Href,
  mine: '/bazaar/mine' as Href,
  library: '/bazaar/library' as Href,
  wallet: '/bazaar/wallet' as Href,
  listing: (id: string) => `/bazaar/${encodeURIComponent(id)}` as Href,
  publish: (params: { appId?: string; listingId?: string; mode?: 'details' } = {}) =>
    ({ pathname: '/bazaar/publish', params: Object.fromEntries(Object.entries(params).filter(([, v]) => !!v)) }) as unknown as Href,
};
