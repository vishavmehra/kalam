import { ChevronRight } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { recordTitle } from '@/core/clone';
import type { KalamRecord, StoredApp } from '@/core/contracts';
import { Sheet, Text, useKalamTheme, webData } from '@/design';
import { RecordExportSheet } from '@/features/templates';
import { useT } from '@/i18n/react';
import { getServices } from '@/services';

/** The newest entries are listed; older ones are reached through the app's own entry page. */
const SHOWN = 40;

export interface ExportEntrySheetProps {
  app: StoredApp | undefined;
  visible: boolean;
  onClose: () => void;
}

/**
 * "Export an entry" from the app's More menu (docs/01 §3.3): pick one entry, then save it as a file or copy it as text.
 * The choice list is read from this device each time the sheet opens, so it is never stale and works offline.
 */
export function ExportEntrySheet({ app, visible, onClose }: ExportEntrySheetProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [rows, setRows] = useState<KalamRecord[] | null>(null);
  const [picked, setPicked] = useState<KalamRecord | null>(null);
  const appId = app?.id;

  useEffect(() => {
    if (!visible || !appId) return undefined;
    let alive = true;
    setRows(null);
    getServices().db.records.listAll(appId).then(
      (all) => alive && setRows(Object.values(all).flat().sort((a, b) => b.updatedAt - a.updatedAt)),
      () => alive && setRows([]),
    );
    return () => { alive = false; };
  }, [visible, appId]);

  const shown = useMemo(() => (rows ?? []).slice(0, SHOWN), [rows]);
  return (
    <>
      <Sheet visible={visible && !picked} onClose={onClose} title={t('runMore.exportTitle')} maxWidth={560}>
        <View style={{ gap: theme.space[2], paddingBottom: theme.space[6] }}>
          {rows === null ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} /> : null}
          {rows !== null && rows.length === 0 ? <Text tone="secondary">{t('runMore.exportNone')}</Text> : null}
          {app ? shown.map((r) => (
            <Pressable
              key={r.id}
              role="button"
              onPress={() => setPicked(r)}
              accessibilityLabel={recordTitle(app.spec, r)}
              {...webData({ kPress: '', kHover: 'surface' })}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: theme.touchTarget + 8,
                paddingVertical: theme.space[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="semibold" numberOfLines={1}>{recordTitle(app.spec, r)}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{app.spec.collections[r.collectionId]?.label ?? r.collectionId}</Text>
              </View>
              <ChevronRight size={18} color={theme.colors.textMuted} />
            </Pressable>
          )) : null}
          {rows !== null && rows.length > SHOWN ? <Text variant="caption" tone="muted">{t('runMore.exportMore', { count: SHOWN })}</Text> : null}
        </View>
      </Sheet>
      {/* The app is only given once an entry is picked, so opening an app never reads every entry for a sheet nobody opened. */}
      <RecordExportSheet app={picked ? (app ?? null) : null} record={picked} onClose={() => { setPicked(null); onClose(); }} />
    </>
  );
}
