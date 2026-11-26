import { callBazaar } from '@/infrastructure/bazaar/functions';

import { createModerationApi } from './api';

/** The moderation and counter calls over the real trusted functions. */
export const moderationApi = createModerationApi(callBazaar);
