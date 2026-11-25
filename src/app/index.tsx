import { Redirect } from 'expo-router';

import { routes } from '@/components/shell/routes';
import { ShelfScreen } from '@/features/shelf/ShelfScreen';
import { useSettingsStore } from '@/state/settings-store';

/** `/` — the App Shelf. First run goes to onboarding (the root layout waits for hydration). */
export default function Index() {
  const onboarded = useSettingsStore((s) => s.settings.onboarded);
  if (!onboarded) return <Redirect href={routes.onboarding} />;
  return <ShelfScreen />;
}
