import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { StoredApp } from '@/core/contracts';
import type { ThemePreset } from '@/core/spec/schema';
import { CATEGORY_LABELS, type CatalogEntry } from '@/core/templates/catalog';
import { Button, Chip, Sheet, Stamp, TextField, Text, useKalamTheme } from '@/design';
import { ClothSwatches } from '@/features/create/PreferencesPanel';
import { useT } from '@/i18n/react';

import { copy } from './copy';
import { buildPreview } from './model';
import { PreviewView } from './PreviewView';
import { useLast } from './use-last';
import { useInstallTemplate } from './use-template-actions';

export interface TemplatePreviewSheetProps {
  /** The template to show. Null keeps the sheet closed. */
  entry: CatalogEntry | null;
  lang?: string;
  onClose: () => void;
  /** The app was saved from the template. The caller usually opens it. */
  onInstalled: (app: StoredApp) => void;
}

/**
 * One template, shown with made-up entries before anything is added (docs/14 §12.5). The person can change the name
 * and the look first (§12.6). "Use this template" validates, saves a separate app and tells the caller.
 */
export function TemplatePreviewSheet({ entry: given, lang, onClose, onInstalled }: TemplatePreviewSheetProps) {
  const entry = useLast(given);
  const t = useT(useKalamTheme().uiLanguage);
  const { install, busy } = useInstallTemplate();
  const [name, setName] = useState('');
  const [look, setLook] = useState<ThemePreset | undefined>(undefined);

  // Every opening starts with the template's own name and look, also when the same template is opened again after being
  // added (state reset while rendering, not in an effect). Closing clears `shown`, so the next opening resets.
  const [shown, setShown] = useState<string | null>(null);
  if ((given?.id ?? null) !== shown) {
    setShown(given?.id ?? null);
    if (given) {
      setName(given.title);
      setLook(given.theme);
    }
  }

  // One preview per opening: the same made-up entries until the sheet is closed.
  const preview = useMemo(() => (entry ? buildPreview(entry, new Date(), lang) : undefined), [entry, lang]);
  const nameProblem = name.trim().length === 0 ? copy.preview.nameLabel : undefined;

  const use = async () => {
    if (!entry || nameProblem) return;
    const choices = { name: name.trim(), ...(look && look !== entry.theme ? { theme: look } : {}) };
    const app = await install(entry.id, choices);
    if (app) onInstalled(app);
  };

  return (
    <Sheet
      visible={!!given}
      onClose={onClose}
      dismissible={!busy}
      title={entry?.title ?? ''}
      description={entry?.description}
      maxWidth={640}
      footer={
        <>
          <Button label={copy.preview.close} variant="ghost" size="md" onPress={onClose} disabled={busy} />
          <Button
            label={busy ? copy.preview.using : copy.preview.use}
            icon={Plus}
            size="md"
            loading={busy}
            disabled={!!nameProblem}
            onPress={() => void use()}
          />
        </>
      }
    >
      {entry && preview ? (
        <View style={{ gap: 20, paddingBottom: 8 }}>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Stamp kind="template" label={t('stamp.template')} size="sm" />
              <Chip label={copy.preview.exampleBadge} tone="accent" />
              <Chip label={CATEGORY_LABELS[entry.category]} tone="neutral" />
            </View>
            <Text variant="bodySmall" tone="secondary">{copy.preview.exampleNote}</Text>
          </View>

          <PreviewView preview={preview} />

          <View style={{ gap: 14 }}>
            <TextField
              label={copy.preview.nameLabel}
              helper={copy.preview.nameHelper}
              value={name}
              onChangeText={setName}
              maxLength={60}
              autoCapitalize="words"
              returnKeyType="done"
            />
            <View style={{ gap: 8 }} role="radiogroup" aria-label={copy.preview.lookLabel}>
              <Text variant="bodySmall" weight="medium" tone="secondary">{copy.preview.lookLabel}</Text>
              {/* The six covers as cloth swatches, as on the create screen; pressing the chosen one returns to the template's own. */}
              <ClothSwatches value={look} onChange={(p) => setLook(p ?? entry.theme)} />
            </View>
          </View>

          <View style={{ gap: 4 }}>
            <Text variant="bodySmall" weight="medium" tone="secondary">{copy.preview.goodToKnow}</Text>
            <Text variant="bodySmall" tone="secondary">{entry.accessibility.summary}</Text>
            <Text variant="bodySmall" tone="secondary">{copy.preview.offline}</Text>
            <Text variant="bodySmall" tone="secondary">{copy.preview.noAi}</Text>
            <Text variant="bodySmall" tone="muted">{copy.card.madeBy(entry.author)}</Text>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
