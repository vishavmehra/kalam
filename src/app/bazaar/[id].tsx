import { useLocalSearchParams } from 'expo-router';

import { lazyRoute } from '@/features/bazaar/lazy-route';

const Screen = lazyRoute(() => import('@/features/bazaar/ListingScreen').then((m) => ({ default: m.ListingScreen })));

/** `/bazaar/[id]` */
export default function ListingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Screen id={String(id)} />;
}
