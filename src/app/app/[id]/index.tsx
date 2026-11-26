import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { RunAppScreen } from '@/runtime/RunAppScreen';

/** /app/[id]: run an installed app (works offline). `?screen=` opens it on that screen (a widget tap or `kalam://app/<id>?screen=<screen>`). */
export default function AppRoute() {
  const { id, screen } = useLocalSearchParams<{ id: string; screen?: string }>();
  const router = useRouter();
  // Clearing the parameter once it is used lets a second tap on the same widget change it again.
  const used = useCallback(() => router.setParams({ screen: undefined }), [router]);
  return <RunAppScreen id={String(id)} startScreen={typeof screen === 'string' ? screen : undefined} onStartScreenUsed={used} />;
}
