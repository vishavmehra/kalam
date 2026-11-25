import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, ConfirmSheet, Text, useBreakpoint, useToast } from '@/design';
import { getDatabase } from '@/infrastructure/storage/database';
import { useAppsStore } from '@/state/apps-store';

import { Section } from './Section';

/**
 * Full local wipe. Backups now live in BackupPanel (encrypted) and space per app in
 * StorageManagerPanel, so the old plain JSON export and import are gone from here.
 */
export function StorageSection() {
  const toast = useToast();
  const { isPhone } = useBreakpoint();
  const refresh = useAppsStore((s) => s.refresh);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const wipe = async () => {
    const db = getDatabase();
    try {
      const [apps, drawings, sessions] = await Promise.all([db.apps.list(), db.drawings.list(), db.sessions.list()]);
      for (const a of apps) await db.apps.remove(a.id);
      for (const d of drawings) await db.drawings.remove(d.id);
      // Saved AI answers and unfinished drafts are data too (docs/11 §6.5).
      for (const s of sessions) await db.sessions.remove(s.id);
      await db.aiCache.clear();
      await db.clearTranslations();
      await db.events.clear();
      await refresh();
      toast.show({ message: 'All apps and data were deleted from this device', tone: 'success' });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Could not delete everything. Some data may remain.', tone: 'danger' });
    } finally {
      setConfirmWipe(false);
    }
  };

  return (
    <Section title="Delete everything" description="Your apps and their records are stored only on this device.">
      <View style={{ gap: 8, paddingVertical: 8, alignItems: isPhone ? 'stretch' : 'flex-start' }}>
        <Button label="Delete all apps and data" icon={Trash2} variant="destructive" onPress={() => setConfirmWipe(true)} fullWidth={isPhone} />
        <Text variant="bodySmall" tone="muted">Your settings stay. Backups you exported are not affected.</Text>
      </View>
      <ConfirmSheet
        visible={confirmWipe}
        title="Delete everything on this device?"
        message="Every app, version, record, drawing, unfinished draft, saved AI answer and the activity log will be permanently removed from this device. This cannot be undone."
        confirmLabel="Delete everything"
        destructive
        onCancel={() => setConfirmWipe(false)}
        onConfirm={wipe}
      />
    </Section>
  );
}
