import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { RestorePreview } from '@/core/clone';
import { Button, Sheet, Text, useKalamTheme } from '@/design';

import { copy } from './copy';

export interface RestoreConfirmSheetProps {
  visible: boolean;
  /** From `previewRestore`. Undefined keeps the sheet closed. */
  preview: RestorePreview | undefined;
  /** The caller saves `confirmRestore(preview)`. May be async: the button shows a spinner until it settles. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** How many changes are listed before "and N more". */
const SHOWN = 8;

function ChangeRow({ text, note, details }: { text: string; note?: string; details?: Array<{ name: string; before?: string; after?: string }> }) {
  const theme = useKalamTheme();
  const [open, setOpen] = useState(false);
  const more = !!note || !!details?.length;
  return (
    <View style={{ gap: 2, minHeight: 36, justifyContent: 'center' }}>
      <Text>{text}</Text>
      {more ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? copy.restore.hideDetail : copy.restore.showDetail}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          hitSlop={8}
          style={{ minHeight: theme.touchTarget, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Text variant="bodySmall" tone="secondary" weight="medium">{open ? copy.restore.hideDetail : copy.restore.showDetail}</Text>
          {open ? <ChevronUp size={16} color={theme.colors.textSecondary} aria-hidden /> : <ChevronDown size={16} color={theme.colors.textSecondary} aria-hidden />}
        </Pressable>
      ) : null}
      {more && open ? (
        <View style={{ gap: 4, paddingBottom: 6 }}>
          {note ? <Text variant="bodySmall" tone="secondary">{note}</Text> : null}
          {(details ?? []).map((d) => (
            <Text key={d.name} variant="bodySmall" tone="secondary">
              {[d.name, d.before !== undefined ? `${copy.restore.before} ${d.before}` : '', d.after !== undefined ? `${copy.restore.after} ${d.after}` : ''].filter(Boolean).join('. ')}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The question before a restore (docs/14 §11.4 and §11.5): what restoring changes in plain words, what happens to saved
 * entries, then the one question. A version that cannot be restored shows why instead of a button that would fail.
 */
export function RestoreConfirmSheet({ visible, preview, onConfirm, onCancel }: RestoreConfirmSheetProps) {
  const [busy, setBusy] = useState(false);
  if (!preview) return null;
  if (!preview.ok) {
    return (
      <Sheet
        visible={visible}
        onClose={onCancel}
        title={copy.restore.problemsHeading}
        footer={<Button label={copy.restore.ok} size="md" onPress={onCancel} />}
      >
        <View style={{ gap: 6 }}>
          {preview.problems.map((p) => <Text key={p}>{p}</Text>)}
        </View>
      </Sheet>
    );
  }
  const shown = preview.changes.slice(0, SHOWN);
  const hidden = preview.changes.length - shown.length;
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      dismissible={!busy}
      title={preview.confirm.title}
      description={preview.confirm.message}
      maxWidth={560}
      footer={
        <>
          <Button label={preview.confirm.cancelLabel} variant="ghost" size="md" onPress={onCancel} disabled={busy} />
          <Button label={preview.confirm.confirmLabel} size="md" loading={busy} onPress={() => void confirm()} />
        </>
      }
    >
      <View style={{ gap: 16, paddingBottom: 8 }}>
        <View style={{ gap: 6 }}>
          <Text variant="h4" accessibilityRole="header">{copy.restore.changesHeading}</Text>
          {shown.length === 1 && shown[0].text === preview.headline ? null : <Text weight="medium">{preview.headline}</Text>}
          {shown.map((c) => <ChangeRow key={c.key} text={c.text} note={c.note} details={c.details} />)}
          {hidden > 0 ? <Text variant="bodySmall" tone="secondary">{copy.restore.more(hidden)}</Text> : null}
        </View>
        {preview.affectsEntries && preview.entryNotes.length ? (
          <View style={{ gap: 4 }}>
            <Text variant="h4" accessibilityRole="header">{copy.restore.entriesHeading}</Text>
            {preview.entryNotes.map((n) => <Text key={n} variant="bodySmall" tone="secondary">{n}</Text>)}
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
