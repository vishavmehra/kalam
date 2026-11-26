import type { Href } from 'expo-router';

/**
 * Routes that start from the shelf. Kept here (not in components/shell/routes.ts) so the shelf owns its own paths;
 * cast to `Href` because typed routes are generated at dev-server start and may not list new files yet.
 */
export const shelfRoutes = {
  templates: '/templates' as Href,
  queue: '/queue' as Href,
  join: (code?: string) => (code ? { pathname: '/join', params: { c: code } } : '/join') as unknown as Href,
};
