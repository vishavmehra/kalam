import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { widgetLink, type PreviewResult, type WidgetView } from '@/core/widgets';
import { Text, useKalamTheme, webData } from '@/design';
import { WIDGET_UI } from './copy';
import { widgetSaid } from './said';
import { useWidgetsController } from './use-widgets';
import { WidgetPreview } from './WidgetPreview';

/** What a tap on a card opens: the same typed action as on the home screen. */
function pathFor(view: WidgetView): string {
  const link = widgetLink(view.widget.appId, view.widget.tap);
  return `/${link.slice('kalam://'.length)}`;
}

/**
 * The widgets the person made, as cards on the shelf (docs/14 §18.3: dashboard cards, the web's version of a home-screen
 * widget). Same definitions, same numbers, worked out on this device each time the shelf comes into view. Nothing is shown
 * for a person with no widgets. A card whose app or source is gone is left out; widget settings tells them why.
 */
export function DashboardCards() {
  const theme = useKalamTheme();
  const { state, controller } = useWidgetsController(undefined, true);
  const [tick, setTick] = useState(0);
  const [bodies, setBodies] = useState<Record<string, PreviewResult>>({});
  // Worked out again whenever the shelf comes back into view, so the numbers are current.
  useFocusEffect(useCallback(() => setTick((n) => n + 1), []));

  useEffect(() => {
    if (!controller) return;
    let alive = true;
    const ok = state.views.filter((v) => v.health.ok);
    Promise.all(ok.map(async (v) => [v.widget.id, await controller.preview(v.widget)] as const))
      .then((pairs) => alive && setBodies(Object.fromEntries(pairs)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [controller, state.views, tick]);

  const shown = state.views.filter((v) => bodies[v.widget.id]?.ok);
  if (!shown.length) return null;
  return (
    <View style={{ gap: theme.space[3] }} role="region" aria-label={WIDGET_UI.cards.heading}>
      <Text variant="h4">{WIDGET_UI.cards.heading}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
        {shown.map((v) => {
          const body = bodies[v.widget.id];
          if (!body?.ok) return null;
          return (
            <Pressable
              key={v.widget.id}
              role="link"
              accessibilityLabel={widgetSaid(body.appName, v.widget.title, body.body)}
              accessibilityHint={WIDGET_UI.cards.hint}
              onPress={() => router.push(pathFor(v) as Parameters<typeof router.push>[0])}
              {...webData({ kPress: '', kHover: 'surface' })}
              style={{ minWidth: 200, maxWidth: 320, flexGrow: 1, flexBasis: 200 }}
            >
              <WidgetPreview plain appName={body.appName} title={v.widget.title} body={body.body} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
