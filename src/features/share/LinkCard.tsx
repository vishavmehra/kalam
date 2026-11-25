import { History, PowerOff, Send, Trash2, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import type { LinkView } from '@/core/share';
import { SHARE_COPY } from '@/core/share';
import { Button, Chip, Surface, Text, useKalamTheme } from '@/design';
import { SHARE_UI } from './copy';
import { InlineConfirm } from './InlineConfirm';
import { formatWhen, historyLine } from './model';

export type LinkStatus = 'on' | 'paused' | 'off';
export const statusOf = (v: LinkView): LinkStatus => (v.link.status === 'revoked' ? 'off' : v.health.ok ? 'on' : 'paused');

export interface LinkCardProps {
  view: LinkView;
  onSend: (view: LinkView) => void;
  onTurnOff: (view: LinkView) => Promise<void>;
  onRemove: (view: LinkView) => Promise<void>;
}

/** One link: what it allows in plain sentences, whether it works right now, and what the person can do with it. */
export function LinkCard({ view, onSend, onTurnOff, onRemove }: LinkCardProps) {
  const theme = useKalamTheme();
  const { link } = view;
  const status = statusOf(view);
  const [asking, setAsking] = useState<'off' | 'remove' | undefined>();
  const [showHistory, setShowHistory] = useState(false);
  const canSend = status === 'on' && link.access === 'write' && view.role === 'source';
  const tone = status === 'on' ? 'success' : status === 'paused' ? 'warning' : 'neutral';
  const problems = view.health.ok || link.status === 'revoked' ? [] : view.health.problems;

  return (
    <Surface padded={theme.space[4]} style={{ gap: theme.space[3] }} testID={`share-link-${link.id}`} accessibilityLabel={SHARE_UI.card.to(view.sourceName, view.destinationName)}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        <Chip label={SHARE_UI.card.status[status]} tone={tone} icon={status === 'paused' ? TriangleAlert : undefined} />
        <Chip label={SHARE_UI.card.kind[link.access]} />
      </View>
      <Text variant="h4">{SHARE_UI.card.to(view.sourceName, view.destinationName)}</Text>

      <View style={{ gap: theme.space[1] }}>
        {view.lines.map((line) => <Text key={line} variant="bodySmall" tone="secondary">{line}</Text>)}
        <Text variant="bodySmall" weight="medium">{SHARE_UI.card.fields(view.fieldLabels)}</Text>
        {view.sourceFromBazaar ? <Text variant="bodySmall" tone="secondary">{SHARE_UI.card.bazaar(view.sourceName)}</Text> : null}
        {view.destinationFromBazaar ? <Text variant="bodySmall" tone="secondary">{SHARE_UI.card.bazaar(view.destinationName)}</Text> : null}
        {link.access === 'write' && view.role === 'destination' && status === 'on' ? (
          <Text variant="bodySmall" tone="secondary">{SHARE_UI.card.sentFromThere(view.sourceName)}</Text>
        ) : null}
        {link.revokedAt !== undefined ? <Text variant="bodySmall" tone="secondary">{SHARE_UI.card.turnedOffOn(formatWhen(link.revokedAt))}</Text> : null}
      </View>

      {problems.length ? (
        <View accessibilityRole="alert" style={{ gap: theme.space[1], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.warningSoft }}>
          {problems.map((p) => <Text key={p.code + (p.field ?? '')} variant="bodySmall">{p.message}</Text>)}
          <Text variant="bodySmall" weight="medium">{SHARE_COPY.pausedNote}</Text>
        </View>
      ) : null}

      {showHistory ? (
        <View style={{ gap: theme.space[1] }} accessibilityRole="list" accessibilityLabel={SHARE_UI.card.history}>
          {[...link.audit].reverse().map((e, i) => <Text key={`${e.at}-${i}`} variant="bodySmall" tone="secondary">{historyLine(e, formatWhen)}</Text>)}
        </View>
      ) : null}

      {asking === 'off' ? (
        <InlineConfirm
          title={SHARE_UI.confirmOff.title}
          message={SHARE_UI.confirmOff.message(view.sourceName, view.destinationName)}
          confirmLabel={SHARE_UI.confirmOff.confirm}
          destructive
          onConfirm={async () => {
            await onTurnOff(view);
            setAsking(undefined);
          }}
          onCancel={() => setAsking(undefined)}
        />
      ) : asking === 'remove' ? (
        <InlineConfirm
          title={SHARE_UI.confirmRemove.title}
          message={SHARE_UI.confirmRemove.message}
          confirmLabel={SHARE_UI.confirmRemove.confirm}
          destructive
          onConfirm={async () => {
            await onRemove(view);
            setAsking(undefined);
          }}
          onCancel={() => setAsking(undefined)}
        />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {canSend ? <Button label={SHARE_UI.card.send} icon={Send} onPress={() => onSend(view)} /> : null}
          {link.status === 'active' ? <Button label={SHARE_UI.card.turnOff} icon={PowerOff} variant="outline" onPress={() => setAsking('off')} /> : null}
          {link.status === 'revoked' ? <Button label={SHARE_UI.card.remove} icon={Trash2} variant="outline" onPress={() => setAsking('remove')} /> : null}
          <Button label={SHARE_UI.card.history} icon={History} variant="ghost" onPress={() => setShowHistory((s) => !s)} />
        </View>
      )}
    </Surface>
  );
}
