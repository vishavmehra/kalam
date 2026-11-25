import { Link2, Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { LinkView } from '@/core/share';
import type { KalamSpec } from '@/core/spec/schema';
import { announce, Button, EmptyState, Sheet, Text, useKalamTheme } from '@/design';
import { SHARE_UI } from './copy';
import { LinkCard } from './LinkCard';
import { NewLinkForm } from './NewLinkForm';
import { SendEntries } from './SendEntries';
import { useShareController } from './use-share';

export interface ShareLinksSheetProps {
  /** The app the person is in. */
  spec: KalamSpec;
  appId: string;
  visible: boolean;
  onClose: () => void;
}

type Screen = { kind: 'list' } | { kind: 'new' } | { kind: 'send'; linkId: string };

/**
 * Create, review and turn off the links between this app and the others on this device (docs/14 §16).
 * Everything here happens on the device. A link only works after the person has read what it allows and
 * agreed, and turning it off takes effect straight away.
 */
export function ShareLinksSheet({ spec, appId, visible, onClose }: ShareLinksSheetProps) {
  const theme = useKalamTheme();
  const { state, controller } = useShareController(appId, visible);
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [notice, setNotice] = useState<string | undefined>();

  const say = useCallback((message: string) => {
    setNotice(message);
    announce(message);
  }, []);

  const sendView: LinkView | undefined = screen.kind === 'send' ? state.views.find((v) => v.link.id === screen.linkId) : undefined;
  // The link vanished (turned off or removed) while the person was choosing entries: show the list instead.
  const where: Screen = screen.kind === 'send' && state.phase === 'ready' && !sendView ? { kind: 'list' } : screen;

  // Opening the sheet again always starts at the list.
  const close = () => {
    setScreen({ kind: 'list' });
    setNotice(undefined);
    onClose();
  };

  const title = where.kind === 'new' ? SHARE_UI.form.title : sendView ? SHARE_UI.send.title(sendView.destinationName) : SHARE_UI.sheetTitle(spec.name);
  const toList = () => setScreen({ kind: 'list' });
  const canMake = state.others.length > 0;

  return (
    <Sheet visible={visible} onClose={close} title={title} description={where.kind === 'list' ? SHARE_UI.sheetIntro : undefined} maxWidth={620}>
      {where.kind === 'new' && controller ? (
        <NewLinkForm
          spec={spec}
          others={state.others}
          onCreate={(draft) => controller.create(draft, spec)}
          onDone={(message) => {
            say(message);
            toList();
          }}
          onBack={toList}
        />
      ) : where.kind === 'send' && sendView && controller ? (
        <SendEntries
          view={sendView}
          controller={controller}
          onBack={toList}
          onSent={(out) => {
            say(out.message);
            toList();
          }}
        />
      ) : (
        <View style={{ gap: theme.space[4], paddingBottom: theme.space[6] }} testID="share-links">
          <View accessibilityLiveRegion="polite">{notice ? <Text weight="medium">{notice}</Text> : null}</View>

          {state.phase === 'loading' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <ActivityIndicator color={theme.colors.primary} accessibilityLabel={SHARE_UI.loading} />
              <Text tone="secondary">{SHARE_UI.loading}</Text>
            </View>
          ) : null}
          {state.phase === 'failed' ? <Text tone="danger" accessibilityRole="alert">{SHARE_UI.loadFailed}</Text> : null}

          {state.phase === 'ready' && !state.views.length ? (
            <EmptyState
              title={SHARE_UI.empty.title}
              description={canMake ? SHARE_UI.empty.description : SHARE_UI.form.noOtherApp}
              action={canMake ? <Button label={SHARE_UI.newLink} icon={Plus} onPress={() => setScreen({ kind: 'new' })} /> : undefined}
            />
          ) : null}

          {state.phase === 'ready' && state.views.length ? (
            <>
              <Text variant="h4">{SHARE_UI.listHeading}</Text>
              {controller
                ? state.views.map((v) => (
                    <LinkCard
                      key={v.link.id}
                      view={v}
                      onSend={(view) => setScreen({ kind: 'send', linkId: view.link.id })}
                      onTurnOff={async (view) => say((await controller.revoke(view.link.id)).ok ? SHARE_UI.turnedOff : SHARE_UI.actionFailed)}
                      onRemove={async (view) => say((await controller.forget(view.link.id)).message)}
                    />
                  ))
                : null}
              {canMake ? <Button label={SHARE_UI.newLink} icon={Link2} variant="outline" onPress={() => setScreen({ kind: 'new' })} /> : null}
            </>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}
