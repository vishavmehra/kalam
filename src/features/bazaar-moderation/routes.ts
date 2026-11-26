import type { Href } from 'expo-router';

/** The moderator page. A static route, so it wins over `/bazaar/[id]`. Cast: typed routes are generated at dev start. */
export const moderationRoute = '/bazaar/moderation' as Href;
