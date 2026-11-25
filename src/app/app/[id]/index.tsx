import { useLocalSearchParams } from 'expo-router';
import { RunAppScreen } from '@/runtime/RunAppScreen';

/** /app/[id] — run an installed app (works offline). */
export default function AppRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RunAppScreen id={String(id)} />;
}
