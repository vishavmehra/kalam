import type { Href } from 'expo-router';

/**
 * Route builders for the Kalam shell. Screens owned by other modules (create, app runtime, edit,
 * bazaar, account) are referenced only here so a path change is a one-line fix. Cast to `Href`
 * because typed routes are generated at dev-server start and may not include sibling routes yet.
 */
export const routes = {
  shelf: '/' as Href,
  onboarding: '/onboarding' as Href,
  create: '/create' as Href,
  bazaar: '/bazaar' as Href,
  activity: '/activity' as Href,
  settings: '/settings' as Href,
  account: '/account' as Href,
  /** Developer-only evaluation page (docs/13 §9.4). Renders nothing in production builds. */
  lab: '/lab' as Href,
  /** Create workspace pre-filled with an editable idea (docs/03 §4.4 — never auto-creates). */
  createWithPrompt: (prompt: string) => ({ pathname: '/create', params: { prompt } }) as unknown as Href,
  app: (id: string) => `/app/${encodeURIComponent(id)}` as Href,
  editApp: (id: string) => `/app/${encodeURIComponent(id)}/edit` as Href,
};
