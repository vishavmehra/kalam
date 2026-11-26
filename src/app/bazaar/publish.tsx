import { useLocalSearchParams } from 'expo-router';

import { lazyRoute } from '@/features/bazaar/lazy-route';

const Screen = lazyRoute(() => import('@/features/bazaar/PublishScreen').then((m) => ({ default: m.PublishScreen })));

/** `/bazaar/publish?appId=&listingId=&mode=details` */
export default function PublishRoute() {
  const { appId, listingId, mode } = useLocalSearchParams<{ appId?: string; listingId?: string; mode?: string }>();
  return (
    <Screen
      appId={appId ? String(appId) : undefined}
      listingId={listingId ? String(listingId) : undefined}
      mode={mode === 'details' ? 'details' : undefined}
    />
  );
}
