import { lazyRoute } from '@/features/bazaar/lazy-route';

const Screen = lazyRoute(() => import('@/features/bazaar/MyListingsScreen').then((m) => ({ default: m.MyListingsScreen })));

/** `/bazaar/mine` */
export default function MyListingsRoute() {
  return <Screen />;
}
