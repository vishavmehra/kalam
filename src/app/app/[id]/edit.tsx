import { useLocalSearchParams } from 'expo-router';
import { EditAppScreen } from '@/features/editing/EditAppScreen';

/** /app/[id]/edit — describe changes, customise the theme, restore versions, verify AI blocks. */
export default function EditAppRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditAppScreen id={String(id)} />;
}
