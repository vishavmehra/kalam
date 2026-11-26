import { AppShell } from '@/components/shell/AppShell';
import { QueueScreen } from '@/features/queue';

/** /queue: tasks that wait for the internet (a build, a translation, an AI step). Reached from the shelf's status pill. */
export default function QueueRoute() {
  return (
    <AppShell active="shelf">
      <QueueScreen />
    </AppShell>
  );
}
