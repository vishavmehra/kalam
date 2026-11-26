import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { WidgetView } from '@/core/widgets';
import { announce, Button, ConfirmSheet, EmptyState, Sheet, SwitchRow, Text, useKalamTheme } from '@/design';
import { platformNotice, WIDGET_UI } from './copy';
import { useWidgetsController } from './use-widgets';
import { WidgetCard } from './WidgetCard';

export interface WidgetSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Widget settings (docs/14 §18.4: user preferences control visibility). Every widget on this device across all apps, with
 * the rules in plain words, a way to remove each one, one switch for the web install menu, and one button that removes
 * everything. Editing a widget is done from its own app, where the choices of that app are.
 */
export function WidgetSettingsSheet({ visible, onClose }: WidgetSettingsSheetProps) {
  const theme = useKalamTheme();
  const { state, controller } = useWidgetsController(undefined, visible);
  const [removing, setRemoving] = useState<WidgetView | undefined>();
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();

  const say = (message: string) => {
    setNotice(message);
    announce(message);
  };
  const a = state.availability;
  const canPin = a?.supported === true && a.canPin;
  const web = a?.supported === false && a.platform === 'web';
  const explain = platformNotice(a);

  const close = () => {
    setNotice(undefined);
    onClose();
  };

  return (
    <>
      <Sheet visible={visible} onClose={close} title={WIDGET_UI.settings.title} description={WIDGET_UI.settings.intro} maxWidth={620}>
        {state.phase === 'loading' ? (
          <View style={{ paddingVertical: theme.space[6], alignItems: 'center' }} accessibilityLabel={WIDGET_UI.loading}>
            <ActivityIndicator />
          </View>
        ) : state.phase === 'failed' ? (
          <Text tone="danger" role="alert">{WIDGET_UI.loadFailed}</Text>
        ) : (
          <View style={{ gap: theme.space[4] }}>
            {notice ? <Text role="status" tone="secondary">{notice}</Text> : null}
            {explain ? <Text variant="bodySmall" tone="secondary">{explain}</Text> : null}
            {web && controller && state.prefs ? (
              <SwitchRow
                label={WIDGET_UI.settings.webShortcutsLabel}
                description={WIDGET_UI.settings.webShortcutsHelp}
                value={state.prefs.webShortcuts}
                onValueChange={(v) => void controller.setPrefs({ webShortcuts: v })}
              />
            ) : null}

            <Text variant="h4">{WIDGET_UI.settings.allHeading}</Text>
            {state.views.length === 0 ? (
              <EmptyState title={WIDGET_UI.empty.title} description={WIDGET_UI.settings.none} />
            ) : (
              <View style={{ gap: theme.space[3] }}>
                {state.views.map((v) => (
                  <WidgetCard
                    key={v.widget.id}
                    view={v}
                    showApp
                    canPin={canPin}
                    onAdd={() => void controller?.addToHomeScreen(v.widget.id).then((r) => say(r.message))}
                    onRemove={() => setRemoving(v)}
                  />
                ))}
              </View>
            )}
            {state.views.length > 0 ? (
              <Button label={WIDGET_UI.settings.clearAll} variant="destructive" onPress={() => setConfirmAll(true)} />
            ) : null}
            <Button label={WIDGET_UI.settings.done} variant="secondary" onPress={close} />
          </View>
        )}
      </Sheet>

      <ConfirmSheet
        visible={!!removing}
        title={WIDGET_UI.card.removeTitle}
        message={WIDGET_UI.card.removeMessage}
        confirmLabel={removing ? `${WIDGET_UI.card.remove} ${removing.widget.title}` : WIDGET_UI.card.remove}
        destructive
        onCancel={() => setRemoving(undefined)}
        onConfirm={async () => {
          const target = removing;
          setRemoving(undefined);
          if (target && controller) say((await controller.remove(target.widget.id)).message);
        }}
      />
      <ConfirmSheet
        visible={confirmAll}
        title={WIDGET_UI.settings.clearTitle}
        message={WIDGET_UI.settings.clearMessage}
        confirmLabel={WIDGET_UI.settings.clearAll}
        destructive
        onCancel={() => setConfirmAll(false)}
        onConfirm={async () => {
          setConfirmAll(false);
          if (controller) say((await controller.clearAll()).message);
        }}
      />
    </>
  );
}
