import { lazyRoute } from '@/features/bazaar/lazy-route';

const Screen = lazyRoute(() => import('@/features/bazaar-moderation/ModerationScreen').then((m) => ({ default: m.ModerationScreen })));

/** `/bazaar/moderation`: the moderator queue. A static route, so it wins over `/bazaar/[id]`. */
export default function ModerationRoute() {
  return <Screen />;
}
