/**
 * The access-mode switches (docs/10 §4), shared by Settings and the optional onboarding step.
 * A change you can see (Large, High contrast, Simple, Left-handed) shows a sample of the result first; every change,
 * once made, can be undone from the toast (docs/03 §19.4). Reset turns every mode off.
 */
import { ALargeSmall, Contrast, Hand, ListChecks, Mic, RotateCcw, Volume2, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import type { AccessModes, KalamSettings } from '@/core/contracts';
import { Button, Sheet, SwitchRow, Text, useKalamTheme, useToast } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';

import { type AccessModeKey, MODE_LABEL, needsPreview, toastKey, withMode } from './access-preview';
import { AccessModePreview } from './AccessModePreview';

export const ACCESS_MODES: Array<{ key: keyof AccessModes; label: TranslationKey; description: TranslationKey; icon: LucideIcon }> = [
  { key: 'large', label: 'settings.access.large', description: 'settings.access.largeHint', icon: ALargeSmall },
  { key: 'highContrast', label: 'settings.access.highContrast', description: 'settings.access.highContrastHint', icon: Contrast },
  { key: 'simple', label: 'settings.access.simple', description: 'settings.access.simpleHint', icon: ListChecks },
  { key: 'readAloud', label: 'settings.access.readAloud', description: 'settings.access.readAloudShellHint', icon: Volume2 },
  { key: 'leftHanded', label: 'settings.access.leftHanded', description: 'settings.access.leftHandedHint', icon: Hand },
  { key: 'voiceOnly', label: 'settings.access.voiceOnly', description: 'settings.access.voiceOnlyHint', icon: Mic },
];

const ALL_OFF: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false, voiceOnly: false };

export function AccessModeSwitches({ modes, set }: { modes: AccessModes; set: (patch: Partial<KalamSettings>) => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const [pending, setPending] = useState<AccessModeKey | null>(null);
  const anyOn = ACCESS_MODES.some((m) => !!modes[m.key]);

  /** Applies a change and offers the way back. `before` is what to restore. */
  const apply = (key: AccessModeKey, value: boolean) => {
    const before = modes;
    set({ accessModes: withMode(modes, key, value) });
    toast.show({
      message: t(toastKey(value), { mode: t(MODE_LABEL[key]) }),
      tone: 'neutral',
      action: { label: t('common.undo'), onPress: () => set({ accessModes: before }) },
    });
  };
  const change = (key: AccessModeKey, value: boolean) => (needsPreview(key, value) ? setPending(key) : apply(key, value));
  const proposed = pending ? withMode(modes, pending, true) : modes;
  const pendingLabel = pending ? t(MODE_LABEL[pending]) : '';

  return (
    <View>
      {ACCESS_MODES.map((m) => (
        <SwitchRow
          key={m.key}
          icon={m.icon}
          label={t(m.label)}
          description={t(m.description)}
          value={!!modes[m.key]}
          onValueChange={(v) => change(m.key, v)}
        />
      ))}
      {anyOn ? (
        <View style={{ paddingTop: 8 }}>
          <Button
            label={t('settings.access.allOff')}
            icon={RotateCcw}
            variant="ghost"
            size="sm"
            onPress={() => {
              const before = modes;
              set({ accessModes: { ...modes, ...ALL_OFF } });
              toast.show({ message: t('settings.access.toastAllOff'), action: { label: t('common.undo'), onPress: () => set({ accessModes: before }) } });
            }}
          />
        </View>
      ) : null}
      <Sheet
        visible={pending !== null}
        onClose={() => setPending(null)}
        title={t('settings.access.preview.title', { mode: pendingLabel })}
        description={t('settings.access.preview.body', { mode: pendingLabel })}
        testID="access-preview-sheet"
        footer={(
          <>
            <Button label={t('settings.access.preview.keep')} variant="secondary" onPress={() => setPending(null)} />
            <Button label={t('settings.access.preview.turnOn')} onPress={() => { if (pending) apply(pending, true); setPending(null); }} />
          </>
        )}
      >
        {pending ? <AccessModePreview modes={proposed} /> : <Text>{''}</Text>}
      </Sheet>
    </View>
  );
}
