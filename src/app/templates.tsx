import { useRouter } from 'expo-router';

import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { Button, useKalamTheme } from '@/design';
import { TemplatesScreen } from '@/features/templates';
import { useT } from '@/i18n/react';

/** /templates: ready-made apps and starter packs. Reached from the empty shelf and the shelf's header. */
export default function TemplatesRoute() {
  const router = useRouter();
  const t = useT(useKalamTheme().uiLanguage);
  return (
    <AppShell active="shelf">
      <TemplatesScreen
        onInstalled={(apps) => router.replace(apps.length === 1 ? routes.app(apps[0]!.id) : routes.shelf)}
        emptyAction={<Button label={t('shelf.create')} onPress={() => router.push(routes.create)} />}
      />
    </AppShell>
  );
}
