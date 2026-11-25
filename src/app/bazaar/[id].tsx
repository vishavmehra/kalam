import { useLocalSearchParams } from 'expo-router';

import { ListingScreen } from '@/features/bazaar/ListingScreen';

/** `/bazaar/[id]` */
export default function ListingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ListingScreen id={String(id)} />;
}
