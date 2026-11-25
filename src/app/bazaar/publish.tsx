import { useLocalSearchParams } from 'expo-router';

import { PublishScreen } from '@/features/bazaar/PublishScreen';

/** `/bazaar/publish?appId=&listingId=&mode=details` */
export default function PublishRoute() {
  const { appId, listingId, mode } = useLocalSearchParams<{ appId?: string; listingId?: string; mode?: string }>();
  return (
    <PublishScreen
      appId={appId ? String(appId) : undefined}
      listingId={listingId ? String(listingId) : undefined}
      mode={mode === 'details' ? 'details' : undefined}
    />
  );
}
