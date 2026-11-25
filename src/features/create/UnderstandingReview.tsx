/**
 * Understanding Review (docs/03 §13, docs/02 §11.5): what Kalam understood, in plain language —
 * a structured review, never a JSON debugger. No internal ids or schema paths are shown.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { CreationResult, UnderstandingSummary } from '@/core/contracts';
import { explainSource, SourceBadge, Surface, Text, useKalamTheme, type ExecutionSource } from '@/design';
import { routeLabel } from './stages';

export function routeSource(route: CreationResult['route']): { source: ExecutionSource; label: string } {
  switch (route) {
    case 'template': return { source: 'deterministic', label: 'Template' };
    case 'template+on_device': return { source: 'on_device', label: 'On-device' };
    case 'cloud': case 'cloud+repair': return { source: 'cloud', label: 'Cloud' };
    case 'specialist': return { source: 'cloud', label: 'Cloud specialist' };
    default: return { source: 'deterministic', label: 'Local' };
  }
}

function Section({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  const { space } = useKalamTheme();
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2] }}>
        <Text variant="h4" accessibilityRole="header">{title}</Text>
        {count !== undefined ? <Text variant="bodyLarge" tone="muted" numeric accessibilityLabel={`${count} items`}>{count}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  const { colors, space } = useKalamTheme();
  return (
    <View accessibilityRole="list" style={{ gap: space[2] }}>
      {items.map((t, i) => (
        <View key={`${i}-${t}`} style={{ flexDirection: 'row', gap: space[2] }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent, marginTop: 9 }} />
          <Text style={{ flex: 1 }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/** Strips anything that looks like a schema path from a warning shown to people. */
const plain = (msg: string) => msg.replace(/\b(screens|collections|actions|aiBlocks)\[[^\]]*\][\w.[\]]*/g, '').replace(/\s{2,}/g, ' ').trim();

export function UnderstandingReview({ result, understanding, builtFrom }: { result: CreationResult; understanding: UnderstandingSummary; builtFrom?: string }) {
  const { colors, space, radius } = useKalamTheme();
  const route = routeSource(result.route);
  const fieldsCount = understanding.collections.reduce((n, c) => n + c.fields.length, 0);
  const warnings = result.warnings.map((w) => plain(w.message)).filter(Boolean);

  return (
    <View style={{ gap: space[8] }}>
      <Section title="Overview">
        <Text variant="bodyLarge">{understanding.purpose}</Text>
        {builtFrom ? (
          <Text variant="bodySmall" tone="secondary" testID="built-from">
            <Text variant="bodySmall" weight="semibold">Built from: </Text>{builtFrom}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
          <SourceBadge source={route.source} label={route.label} />
          {/* Plain words here (docs/03 §2.1); model names and timings live on the Activity page. */}
          <Text variant="bodySmall" tone="secondary" style={{ flexShrink: 1 }}>
            {routeLabel(result.route)}. {explainSource(route.source)}
          </Text>
        </View>
      </Section>

      {warnings.length || result.clarifications?.length ? (
        <Surface tone="accentSoft" padded radius="lg" style={{ gap: space[2] }}>
          <Text weight="semibold">Worth checking</Text>
          <Bullets items={[...(result.clarifications ?? []), ...warnings]} />
        </Surface>
      ) : null}

      <Section title="Screens" count={understanding.screens.length}>
        <View style={{ gap: space[3] }}>
          {understanding.screens.map((s, i) => (
            <View key={s.id} style={{ borderLeftWidth: 2, borderLeftColor: colors.primary, paddingLeft: space[4], gap: space[2] }}>
              <Text weight="semibold">{i + 1}. {s.title}</Text>
              {s.items.length ? <Bullets items={s.items} /> : <Text tone="muted">Empty screen</Text>}
            </View>
          ))}
        </View>
      </Section>

      <Section title="Fields" count={fieldsCount}>
        {understanding.collections.length === 0 ? <Text tone="muted">This app does not store records.</Text> : (
          <View style={{ gap: space[4] }}>
            {understanding.collections.map((c) => (
              <View key={c.id} style={{ gap: space[2] }}>
                <Text weight="semibold">{c.name}</Text>
                <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
                  {c.fields.map((f, i) => (
                    <View
                      key={`${f.label}-${i}`}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], paddingHorizontal: space[3],
                        borderTopWidth: i ? 1 : 0, borderTopColor: colors.border, backgroundColor: colors.surface,
                      }}
                    >
                      <Text style={{ flex: 1 }}>{f.label}</Text>
                      <Text variant="bodySmall" tone="secondary">{f.type}</Text>
                      <Text variant="caption" tone={f.required ? 'primary' : 'muted'} style={{ minWidth: 64, textAlign: 'right' }}>
                        {f.required ? 'Required' : 'Optional'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section title="Actions" count={understanding.actions.length}>
        {understanding.actions.length ? <Bullets items={understanding.actions} /> : <Text tone="muted">No buttons that change data.</Text>}
      </Section>

      <Section title="Data">
        <Text>
          {understanding.collections.length
            ? `${understanding.collections.map((c) => c.name).join(', ')}. Saved on this device and usable offline.`
            : 'Nothing is saved between uses.'}
        </Text>
      </Section>

      <Section title="AI features" count={understanding.aiFeatures.length}>
        {understanding.aiFeatures.length ? (
          <View style={{ gap: space[2] }}>
            {understanding.aiFeatures.map((a) => (
              <View key={a.id} style={{ gap: space[1] }}>
                <Text>{a.description}</Text>
                <Text variant="bodySmall" tone="secondary">{a.verified}</Text>
              </View>
            ))}
          </View>
        ) : <Text tone="muted">None. Everything in this app runs without AI.</Text>}
      </Section>

      {understanding.assumptions.length ? (
        <Section title="Assumptions">
          <Bullets items={understanding.assumptions} />
        </Section>
      ) : null}
    </View>
  );
}
