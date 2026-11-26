import { Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { KalamSpec } from '@/core/spec/schema';
import type { WidgetDraft, WidgetView } from '@/core/widgets';
import { announce, Button, ConfirmSheet, EmptyState, Sheet, SwitchRow, Text, useKalamTheme } from '@/design';
import { platformNotice, WIDGET_UI } from './copy';
import { emptyForm, formFromWidget } from './form-model';
import { addedMessage, savedMessage, widgetAbilities } from './sheet-model';
import { useWidgetsController } from './use-widgets';
import { WidgetCard } from './WidgetCard';
import { WidgetFormView } from './WidgetFormView';

export interface AddToHomeScreenSheetProps {
  /** The app the person is in. */
  spec: KalamSpec;
  appId: string;
  visible: boolean;
  onClose: () => void;
}

type Screen = { kind: 'list' } | { kind: 'form'; editing?: string };

/**
 * "Add to home screen" (docs/14 §18): make, change, add and remove the widgets of one app. The person picks what to show from
 * what the app already shows, chooses which fields may appear, and sees exactly what the widget will say before saving. Nothing
 * leaves the device. Making a widget never depends on the platform: where it has no home screen widgets (the web, a build
 * without the module) the widget shows as a card on the shelf, the sheet says so, and only "Add to home screen" is left out.
 */
export function AddToHomeScreenSheet({ spec, appId, visible, onClose }: AddToHomeScreenSheetProps) {
  const theme = useKalamTheme();
  const { state, controller } = useWidgetsController(appId, visible);
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [notice, setNotice] = useState<string | undefined>();
  const [removing, setRemoving] = useState<WidgetView | undefined>();
  const [busy, setBusy] = useState(false);

  const say = useCallback((message: string) => {
    setNotice(message);
    announce(message);
  }, []);

  const a = state.availability;
  const { canCreate, canPin } = widgetAbilities(a);
  const explain = platformNotice(a);
  const web = a?.supported === false && a.platform === 'web';

  // Opening the sheet again always starts at the list.
  const close = () => {
    setScreen({ kind: 'list' });
    setNotice(undefined);
    onClose();
  };
  const toList = () => setScreen({ kind: 'list' });

  const editing = screen.kind === 'form' && screen.editing ? state.views.find((v) => v.widget.id === screen.editing) : undefined;
  // The widget being edited vanished (removed elsewhere): show the list instead.
  const where: Screen = screen.kind === 'form' && screen.editing && state.phase === 'ready' && !editing ? { kind: 'list' } : screen;

  const save = async (draft: WidgetDraft, andAdd: boolean) => {
    if (!controller) return { ok: false as const, reason: 'store' as const, message: WIDGET_UI.status.saveFailed };
    const r = editing ? await controller.update(editing.widget.id, draft) : await controller.create(draft);
    if (!r.ok) return r;
    // Says so when the home screen did not take the new text, instead of a plain "saved".
    const saved = savedMessage(r.sync);
    if (andAdd && canPin) say(addedMessage(saved, await controller.addToHomeScreen(r.widget.id)));
    else say(saved);
    toList();
    return r;
  };

  const askToAdd = async (view: WidgetView) => {
    if (!controller) return;
    setBusy(true);
    try {
      const r = await controller.addToHomeScreen(view.widget.id);
      say(r.message);
    } finally {
      setBusy(false);
    }
  };

  const title = where.kind === 'form' ? (editing ? WIDGET_UI.form.titleEdit : WIDGET_UI.form.titleNew) : WIDGET_UI.sheetTitle(spec.name);

  return (
    <>
      <Sheet visible={visible} onClose={close} title={title} description={where.kind === 'list' ? WIDGET_UI.sheetIntro : undefined} maxWidth={620}>
        {state.phase === 'loading' ? (
          <View style={{ paddingVertical: theme.space[6], alignItems: 'center' }} accessibilityLabel={WIDGET_UI.loading}>
            <ActivityIndicator />
          </View>
        ) : state.phase === 'failed' ? (
          <Text tone="danger" role="alert">{WIDGET_UI.loadFailed}</Text>
        ) : where.kind === 'form' && controller && canCreate ? (
          <WidgetFormView
            key={where.editing ?? 'new'}
            spec={spec}
            candidates={state.candidates}
            initial={editing ? formFromWidget(editing.widget, state.candidates) : emptyForm()}
            editing={!!editing}
            canPin={canPin}
            preview={controller.preview}
            onSave={save}
            onBack={toList}
          />
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

            {canCreate ? (
              <>
                {state.views.length === 0 ? (
                  <EmptyState title={WIDGET_UI.empty.title} description={WIDGET_UI.empty.description} />
                ) : (
                  <View style={{ gap: theme.space[3] }}>
                    <Text variant="h4">{WIDGET_UI.listHeading}</Text>
                    {state.views.map((v) => (
                      <WidgetCard
                        key={v.widget.id}
                        view={v}
                        canPin={canPin}
                        busy={busy}
                        onAdd={() => void askToAdd(v)}
                        onEdit={() => setScreen({ kind: 'form', editing: v.widget.id })}
                        onRemove={() => setRemoving(v)}
                      />
                    ))}
                  </View>
                )}
                <Button label={WIDGET_UI.newWidget} icon={Plus} onPress={() => setScreen({ kind: 'form' })} />
              </>
            ) : null}
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
    </>
  );
}
