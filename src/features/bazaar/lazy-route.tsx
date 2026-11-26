import { type ComponentProps, type ComponentType, lazy, Suspense } from 'react';

import { AppShell } from '@/components/shell/AppShell';
import { Screen, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { Busy } from './parts';

function Loading() {
  const t = useT(useKalamTheme().uiLanguage);
  return (
    <AppShell active="bazaar">
      <Screen><Busy text={t('bazaar.loading')} /></Screen>
    </AppShell>
  );
}

/**
 * A Bazaar route that loads its screen on first visit, so the shelf, Make and the apps you run do not pay for
 * Bazaar, publishing and moderation code at start. The navigation shell shows while the screen arrives.
 * `load` is `() => import('...').then((m) => ({ default: m.Screen }))`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRoute<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  const Inner = lazy(load);
  return function LazyRoute(props: ComponentProps<C>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forward = props as any;
    return <Suspense fallback={<Loading />}><Inner {...forward} /></Suspense>;
  };
}
