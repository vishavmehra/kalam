import { View } from 'react-native';

import { type Conflict, type SyncValues } from '@/core/collab';
import { COLLAB_COPY } from './copy';
import type { KalamCollection, KalamSpec } from '@/core/spec/schema';
import { Button, Surface, Text, useKalamTheme } from '@/design';
import { getCollabService } from '@/infrastructure/collab/service';

const C = COLLAB_COPY.conflicts;

export interface ConflictListProps {
  appId: string;
  spec: KalamSpec;
  conflicts: Conflict[];
  /** Public name for a uid (from the member list); falls back to "Someone". */
  nameOf: (uid: string) => string;
  onMessage?: (text: string) => void;
}

/** A short name for the entry: its first filled text field, else its first filled value. */
export function entryName(values: SyncValues | undefined, collection: KalamCollection | undefined): string {
  const fields = Object.entries(collection?.fields ?? {}).filter(([, f]) => f.type !== 'image');
  const filled = (id: string) => values?.[id] !== undefined && values[id] !== null && values[id] !== '';
  const text = fields.find(([id, f]) => f.type === 'text' && filled(id));
  const any = text ?? fields.find(([id]) => filled(id));
  return any ? String(values![any[0]]).slice(0, 60) : C.unnamedEntry;
}

/**
 * Entries changed in two places at once (docs/14 §17.5, §26: "Show conflict resolution"). Each says which
 * entry it is, shows the values in words (both sides of a clash, or the version that would be kept or
 * lost for a deletion), and the person picks one. Until then this device keeps its own value.
 */
export function ConflictList({ appId, spec, conflicts, nameOf, onMessage }: ConflictListProps) {
  const theme = useKalamTheme();
  if (!conflicts.length) return null;
  const resolve = async (c: Conflict, choice: 'mine' | 'theirs') => {
    const res = await getCollabService().resolve(appId, c.id, choice);
    onMessage?.(res.ok ? C.resolved : res.message);
  };
  return (
    <View style={{ gap: theme.space[3] }} testID="collab-conflicts">
      <Text variant="h4" accessibilityRole="header">{C.heading}</Text>
      <Text variant="bodySmall" tone="secondary">{C.intro}</Text>
      {conflicts.map((c) => {
        const collection = spec.collections[c.collectionId];
        const fields = collection?.fields ?? {};
        const label = (id: string) => fields[id]?.label ?? id;
        const name = entryName(c.kind === 'deleted_here' ? c.theirs : c.mine ?? c.theirs, collection);
        // For a deletion, the version that is still there: theirs when this device deleted it, mine when they did.
        const shown = c.kind === 'deleted_here' ? c.theirs : c.kind === 'deleted_there' ? c.mine : undefined;
        const rows = shown ? Object.keys(fields).filter((id) => fields[id]!.type !== 'image' && shown[id] !== undefined) : [];
        const [mine, theirs] = c.kind === 'both_changed' ? [C.keepMine, C.useTheirs] : c.kind === 'deleted_here' ? [C.keepDeleted, C.restore] : [C.keepEntry, C.acceptDelete];
        return (
          <Surface key={c.id} tone="alt" padded bordered>
            <View style={{ gap: theme.space[2] }}>
              <Text weight="semibold">{C.title(c.kind, nameOf(c.theirActor))}</Text>
              <Text variant="bodySmall">{C.entry(name)}</Text>
              {c.fields.map((f) => (
                <Text key={f.field} variant="bodySmall">{C.field(label(f.field), f.mine, f.theirs)}</Text>
              ))}
              {shown && rows.length ? (
                <View style={{ gap: theme.space[1] }}>
                  <Text variant="bodySmall" weight="medium">{c.kind === 'deleted_here' ? C.theirVersion : C.yourVersion}</Text>
                  {rows.map((id) => (
                    <Text key={id} variant="bodySmall" tone="secondary">{C.value(label(id), shown[id] ?? null)}</Text>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                <Button label={mine} variant="outline" accessibilityHint={C.forEntry(name)} onPress={() => void resolve(c, 'mine')} />
                <Button label={theirs} variant="outline" accessibilityHint={C.forEntry(name)} onPress={() => void resolve(c, 'theirs')} />
              </View>
            </View>
          </Surface>
        );
      })}
    </View>
  );
}
