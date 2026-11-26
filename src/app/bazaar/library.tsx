import { lazyRoute } from '@/features/bazaar/lazy-route';

const Screen = lazyRoute(() => import('@/features/bazaar/LibraryScreen').then((m) => ({ default: m.LibraryScreen })));

/** `/bazaar/library` */
export default function LibraryRoute() {
  return <Screen />;
}
