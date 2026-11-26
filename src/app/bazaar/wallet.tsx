import { lazyRoute } from '@/features/bazaar/lazy-route';

const Screen = lazyRoute(() => import('@/features/bazaar/WalletScreen').then((m) => ({ default: m.WalletScreen })));

/** `/bazaar/wallet` */
export default function WalletRoute() {
  return <Screen />;
}
