import { lazyRoute } from '@/features/bazaar/lazy-route';

const Screen = lazyRoute(() => import('@/features/bazaar/BazaarScreen').then((m) => ({ default: m.BazaarScreen })));

/** `/bazaar` */
export default function BazaarRoute() {
  return <Screen />;
}
