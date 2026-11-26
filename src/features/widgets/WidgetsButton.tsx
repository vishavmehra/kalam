import { LayoutGrid } from 'lucide-react-native';
import { useState } from 'react';

import type { KalamSpec } from '@/core/spec/schema';
import { Button, IconButton } from '@/design';
import { AddToHomeScreenSheet } from './AddToHomeScreenSheet';
import { WIDGET_UI } from './copy';
import { WidgetSettingsSheet } from './WidgetSettingsSheet';

/**
 * Header button that opens the widget sheet for one app. Owns its own sheet state.
 * `compact` shows an icon only, for phones where the app name needs the room.
 */
export function WidgetsButton({ spec, appId, compact }: { spec: KalamSpec; appId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <IconButton icon={LayoutGrid} label={WIDGET_UI.button} onPress={() => setOpen(true)} />
      ) : (
        <Button label={WIDGET_UI.button} variant="ghost" icon={LayoutGrid} onPress={() => setOpen(true)} accessibilityHint={WIDGET_UI.buttonHint} />
      )}
      <AddToHomeScreenSheet spec={spec} appId={appId} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Settings row that opens the device-wide widget settings. Owns its own sheet state. */
export function WidgetSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label={WIDGET_UI.settings.open} variant="secondary" icon={LayoutGrid} onPress={() => setOpen(true)} />
      <WidgetSettingsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
