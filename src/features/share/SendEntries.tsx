import { ArrowLeft, Check, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { SHARE_LIMITS, type LinkView, type Sendable, type SendOutcome } from '@/core/share';
import { Button, Chip, SwitchRow, Text, useKalamTheme, webData } from '@/design';
import type { ShareController } from './controller';
import { SHARE_UI } from './copy';
import { pressOnSpace } from './keys';
import { chooseAllEntries, sendPlan, toggleEntry } from './model';
import { InlineConfirm } from './InlineConfirm';

export interface SendEntriesProps {
  /** A link that sends, seen from the app that is the source. */
  view: LinkView;
  controller: ShareController;
  onBack: () => void;
  /** The send finished. The message says what was sent and what was not. */
  onSent: (outcome: SendOutcome) => void;
}

type Loaded =
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; items: Sendable[]; total: number };

function Entry({ item, chosen, onPress }: { item: Sendable; chosen: boolean; onPress: () => void }) {
  const theme = useKalamTheme();
  const c = theme.colors;
  return (
    <Pressable
      role="checkbox"
      aria-checked={chosen}
      accessibilityState={{ checked: chosen }}
      accessibilityLabel={item.alreadySent ? `${item.title}, ${SHARE_UI.send.sentBefore}` : item.title}
      onPress={onPress}
      {...pressOnSpace(onPress)}
      {...webData({ kPress: '', kHover: 'surface' })}
      style={{
        minHeight: theme.touchTarget, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2],
        paddingHorizontal: theme.space[3], borderRadius: theme.radius.md, borderWidth: chosen ? 2 : 1,
        borderColor: chosen ? c.primary : c.border, backgroundColor: chosen ? c.primarySoft : 'transparent',
      }}
    >
      <View
        style={{
          width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
          borderColor: chosen ? c.primary : c.borderStrong, backgroundColor: chosen ? c.primary : 'transparent',
        }}
      >
        {chosen ? <Check size={14} color={c.onPrimary} strokeWidth={3} /> : null}
      </View>
      <Text style={{ flex: 1 }} numberOfLines={2}>{item.title}</Text>
      {item.alreadySent ? <Chip label={SHARE_UI.send.sentBefore} /> : null}
    </Pressable>
  );
}

/**
 * Choose entries of a `write` link and send them. Nothing moves until the person has seen the count and the
 * names of the fields, and pressed Send. The other app checks every entry again before it keeps it.
 */
export function SendEntries({ view, controller, onBack, onSent }: SendEntriesProps) {
  const theme = useKalamTheme();
  const linkId = view.link.id;
  const limit = SHARE_LIMITS.sendBatch;
  const [loaded, setLoaded] = useState<Loaded>({ phase: 'loading' });
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [update, setUpdate] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    let alive = true;
    void controller.sendable(linkId).then((r) => {
      if (alive) setLoaded(r.ok ? { phase: 'ready', items: r.items, total: r.total } : { phase: 'failed', message: r.message });
    });
    return () => {
      alive = false;
    };
  }, [controller, linkId]);

  const items = loaded.phase === 'ready' ? loaded.items : [];
  const plan = sendPlan(items, chosen, update);
  const willSend = plan.create + plan.change;
  const anySentBefore = items.some((i) => i.alreadySent);

  const send = async () => {
    const out = await controller.send(linkId, [...chosen], update);
    onSent(out);
  };

  return (
    <View style={{ gap: theme.space[4], paddingBottom: theme.space[6] }} testID="share-send">
      <Text tone="secondary">{SHARE_UI.send.help(view.fieldLabels)}</Text>

      {loaded.phase === 'loading' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel={SHARE_UI.send.loading} />
          <Text tone="secondary">{SHARE_UI.send.loading}</Text>
        </View>
      ) : null}
      {loaded.phase === 'failed' ? <Text tone="danger" accessibilityRole="alert">{loaded.message || SHARE_UI.send.failed}</Text> : null}
      {loaded.phase === 'ready' && !items.length ? <Text tone="secondary">{SHARE_UI.send.empty}</Text> : null}

      {items.length && !reviewing ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <Button label={SHARE_UI.send.selectAll} variant="outline" onPress={() => setChosen(chooseAllEntries(items.map((i) => i.id), limit))} />
            <Button label={SHARE_UI.send.clear} variant="ghost" onPress={() => setChosen(new Set())} disabled={!chosen.size} />
          </View>
          <View role="group" aria-label={SHARE_UI.send.listLabel} accessibilityLabel={SHARE_UI.send.listLabel} style={{ gap: theme.space[2] }}>
            {items.map((item) => (
              <Entry key={item.id} item={item} chosen={chosen.has(item.id)} onPress={() => setChosen(toggleEntry(chosen, item.id, limit))} />
            ))}
          </View>
          <View accessibilityLiveRegion="polite">
            <Text variant="bodySmall" tone="secondary">{SHARE_UI.send.chosen(chosen.size)}</Text>
          </View>
          {loaded.phase === 'ready' && loaded.total > items.length ? (
            <Text variant="bodySmall" tone="secondary">{SHARE_UI.send.more(items.length, loaded.total)}</Text>
          ) : null}
          {chosen.size >= limit ? <Text variant="bodySmall" tone="secondary">{SHARE_UI.send.limit(limit)}</Text> : null}
          {anySentBefore ? (
            <SwitchRow label={SHARE_UI.send.update} description={SHARE_UI.send.updateHelp} value={update} onValueChange={setUpdate} />
          ) : null}
        </>
      ) : null}

      {reviewing ? (
        <InlineConfirm
          title={SHARE_UI.send.confirmTitle(view.destinationName)}
          message={SHARE_UI.send.confirmMessage(plan, view.fieldLabels, view.destinationName)}
          confirmLabel={SHARE_UI.send.confirm}
          onConfirm={send}
          onCancel={() => setReviewing(false)}
        />
      ) : (
        <View style={{ gap: theme.space[2] }}>
          {chosen.size && !willSend ? <Text variant="bodySmall" tone="secondary">{SHARE_UI.send.nothingToDo}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <Button label={SHARE_UI.send.action(willSend)} icon={Send} onPress={() => setReviewing(true)} disabled={!willSend} />
            <Button label={SHARE_UI.send.back} icon={ArrowLeft} variant="outline" onPress={onBack} />
          </View>
        </View>
      )}
    </View>
  );
}
