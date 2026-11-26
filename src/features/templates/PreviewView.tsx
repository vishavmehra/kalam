import { Check, Square } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { View } from 'react-native';

import { Chip, Surface, Text, useKalamTheme } from '@/design';

import { copy } from './copy';
import type { PreviewBlock, PreviewScreen, TemplatePreview } from './model';

function StatGrid({ stats }: { stats: Extract<PreviewBlock, { kind: 'stat' }>[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {stats.map((s) => (
        <Surface
          key={s.id} tone="alt" padded={12} radius="paper"
          style={{ flexGrow: 1, flexBasis: 140, gap: 2 }}
          accessible accessibilityLabel={`${s.label}: ${s.value}`}
        >
          <Text variant="caption" tone="secondary" aria-hidden>{s.label}</Text>
          <Text variant="h4" numeric aria-hidden>{s.value}</Text>
        </Surface>
      ))}
    </View>
  );
}

function ListBlock({ block }: { block: Extract<PreviewBlock, { kind: 'list' }> }) {
  const theme = useKalamTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="h4" accessibilityRole="header">{block.label}</Text>
      {block.rows.length === 0 ? (
        <Text variant="bodySmall" tone="muted">{block.empty || copy.preview.emptyList}</Text>
      ) : (
        <View style={{ gap: 2 }}>
          {block.rows.map((r, i) => {
            const spoken = [r.primary, r.secondary, r.checked === undefined ? undefined : r.checked ? 'done' : 'not done'].filter(Boolean).join(', ');
            return (
              <View
                key={`${i}-${r.primary}`} accessible accessibilityLabel={spoken}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
              >
                {r.checked === undefined ? null : r.checked ? (
                  <Check size={18} color={theme.colors.success} aria-hidden />
                ) : (
                  <Square size={18} color={theme.colors.textMuted} aria-hidden />
                )}
                <Text style={{ flex: 1 }} numberOfLines={1} aria-hidden>{r.primary}</Text>
                {r.secondary ? <Text tone="secondary" numeric aria-hidden>{r.secondary}</Text> : null}
              </View>
            );
          })}
          {block.more > 0 ? <Text variant="bodySmall" tone="muted" style={{ paddingTop: 6 }}>{copy.preview.more(block.more)}</Text> : null}
        </View>
      )}
    </View>
  );
}

/** Draws consecutive totals as one grid and everything else in order. Nothing here can be pressed. */
function Blocks({ screen }: { screen: PreviewScreen }) {
  const nodes: ReactNode[] = [];
  let run: Extract<PreviewBlock, { kind: 'stat' }>[] = [];
  const flush = () => {
    if (run.length) nodes.push(<StatGrid key={`stats-${run[0]!.id}`} stats={run} />);
    run = [];
  };
  for (const b of screen.blocks) {
    if (b.kind === 'stat') { run.push(b); continue; }
    flush();
    switch (b.kind) {
      case 'list': nodes.push(<ListBlock key={b.id} block={b} />); break;
      case 'note': nodes.push(<Text key={b.id} variant={b.heading ? 'h4' : 'bodySmall'} tone={b.heading ? 'default' : 'secondary'}>{b.label}</Text>); break;
      case 'other': nodes.push(<Text key={b.id} variant="bodySmall" tone="secondary">{b.label}</Text>); break;
      case 'buttons': nodes.push(<Text key={b.id} variant="bodySmall" tone="secondary">{`Buttons: ${b.labels.join(', ')}`}</Text>); break;
      case 'fields': nodes.push(<Text key={b.id} variant="bodySmall" tone="secondary">{`${copy.preview.fieldsOn}: ${b.labels.join(', ')}`}</Text>); break;
    }
  }
  flush();
  return <View style={{ gap: 14 }}>{nodes}</View>;
}

/** The first screen of a template as it looks with the made-up entries, then the names of its other screens. */
export function PreviewView({ preview }: { preview: TemplatePreview }) {
  const first = preview.screens[0];
  const others = preview.screens.slice(1);
  if (!first) return null;
  return (
    <View role="group" aria-label={copy.preview.regionLabel(preview.title)} style={{ gap: 14 }}>
      <Surface tone="paper" bordered radius="paper" padded={16} style={{ gap: 14 }}>
        <Text variant="h4" accessibilityRole="header">{first.title}</Text>
        <Blocks screen={first} />
      </Surface>
      {others.length ? (
        <View style={{ gap: 8 }}>
          <Text variant="bodySmall" weight="medium" tone="secondary">{copy.preview.otherScreens}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {others.map((s) => <Chip key={s.id} label={s.title} tone="neutral" />)}
          </View>
        </View>
      ) : null}
    </View>
  );
}
