/**
 * The access-mode switches (docs/10 §4), shared by Settings and the optional onboarding step.
 * Changes apply at once, so the screen itself is the preview; Reset turns every mode off.
 */
import { ALargeSmall, Contrast, Hand, ListChecks, Mic, RotateCcw, Volume2, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import type { AccessModes, KalamSettings } from '@/core/contracts';
import { Button, SwitchRow } from '@/design';

export const ACCESS_MODES: Array<{ key: keyof AccessModes; label: string; description: string; icon: LucideIcon }> = [
  { key: 'large', label: 'Large', description: 'Bigger text and touch targets in Kalam and your apps.', icon: ALargeSmall },
  { key: 'highContrast', label: 'High contrast', description: 'Stronger text, borders and focus outlines. Overrides app colours.', icon: Contrast },
  { key: 'simple', label: 'Simple', description: 'Fewer options on screen. Hides the Activity page.', icon: ListChecks },
  { key: 'readAloud', label: 'Read aloud', description: 'Kalam and your apps speak headings and results.', icon: Volume2 },
  { key: 'leftHanded', label: 'Left-handed', description: 'Main actions move to the left. Text direction never changes.', icon: Hand },
  { key: 'voiceOnly', label: 'Voice only', description: 'Your apps say each screen and what you can say. Tap the microphone to talk.', icon: Mic },
];

const ALL_OFF: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false, voiceOnly: false };

export function AccessModeSwitches({ modes, set }: { modes: AccessModes; set: (patch: Partial<KalamSettings>) => void }) {
  const anyOn = ACCESS_MODES.some((m) => !!modes[m.key]);
  return (
    <View>
      {ACCESS_MODES.map((m) => (
        <SwitchRow
          key={m.key}
          icon={m.icon}
          label={m.label}
          description={m.description}
          value={!!modes[m.key]}
          onValueChange={(v) => set({ accessModes: { ...modes, [m.key]: v } })}
        />
      ))}
      {anyOn ? (
        <View style={{ paddingTop: 8 }}>
          <Button label="Turn all modes off" icon={RotateCcw} variant="ghost" size="sm" onPress={() => set({ accessModes: { ...modes, ...ALL_OFF } })} />
        </View>
      ) : null}
    </View>
  );
}
