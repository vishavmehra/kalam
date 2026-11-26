import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { StoredApp } from '@/core/contracts';
import { PACK_UI, STARTER_PACKS, isTemplateOnShelf, packInstallNotice, packSuggestedModes, type StarterPack } from '@/core/starter-packs';
import { getCatalogEntry } from '@/core/templates/catalog';
import { Button, Chip, Sheet, slipNumber, Stamp, Surface, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';
import { useAppsStore } from '@/state/apps-store';

import { copy } from './copy';
import { MiniRegister } from './MiniRegister';
import { useLast } from './use-last';
import { useInstallPack } from './use-template-actions';

function PackCard({ pack, onOpen }: { pack: StarterPack; onOpen: (p: StarterPack) => void }) {
  const theme = useKalamTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.packs.open(pack.title)}
      accessibilityHint={copy.packs.openHint}
      onPress={() => onOpen(pack)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, minHeight: theme.touchTarget })}
    >
      <Surface radius="paper" padded={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <MiniRegister preset={pack.theme} glyph={pack.glyph} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h4" aria-hidden>{pack.title}</Text>
          <Text variant="bodySmall" tone="secondary" aria-hidden>{pack.tagline}</Text>
        </View>
        <Chip label={PACK_UI.appsIn(pack.apps.length)} tone="neutral" />
      </Surface>
    </Pressable>
  );
}

function PackSheet({ pack: given, onClose, onInstalled }: { pack: StarterPack | null; onClose: () => void; onInstalled: (apps: StoredApp[]) => void }) {
  const pack = useLast(given);
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const shelf = useAppsStore((s) => s.apps);
  const { install, busy } = useInstallPack();
  const [message, setMessage] = useState<string | undefined>();
  const [failed, setFailed] = useState<string | undefined>();

  const rows = useMemo(
    () => (pack ? pack.apps.map((id) => ({ id, title: getCatalogEntry(id)?.title ?? id, onShelf: isTemplateOnShelf(shelf, id) })) : []),
    [pack, shelf],
  );
  const fresh = rows.filter((r) => !r.onShelf).length;
  const modes = pack ? packSuggestedModes(pack).map((m) => copy.packs.modes[m]) : [];

  const run = async () => {
    if (!pack) return;
    setMessage(undefined);
    setFailed(undefined);
    const r = await install(pack.id);
    if ('error' in r) { setFailed(r.error); return; }
    const notice = packInstallNotice(r);
    setMessage(notice.message);
    setFailed(notice.failure);
    // Leave the sheet only when everything went well. After a failure it stays open, says which apps are missing and
    // lets the person try again, which adds only what is not on the shelf yet.
    if (notice.complete && r.added.length) onInstalled(r.added);
  };

  const close = () => {
    setMessage(undefined);
    setFailed(undefined);
    onClose();
  };

  return (
    <Sheet
      visible={!!given}
      onClose={close}
      dismissible={!busy}
      title={pack?.title ?? ''}
      description={pack?.tagline}
      maxWidth={640}
      footer={
        <>
          <Button label={copy.packs.close} variant="ghost" size="md" onPress={close} disabled={busy} />
          <Button
            label={fresh === 0 ? PACK_UI.installed : PACK_UI.installAll(fresh)}
            icon={Plus}
            size="md"
            loading={busy}
            disabled={fresh === 0}
            onPress={() => void run()}
          />
        </>
      }
    >
      {pack ? (
        <View style={{ gap: 20, paddingBottom: 8 }}>
          {pack.notice ? (
            <Surface tone="accentSoft" radius="paper" padded={12} style={{ gap: 8 }} accessibilityRole="alert">
              <Stamp kind="needs" label={t('stamp.needs')} size="sm" />
              <Text variant="bodySmall">{pack.notice}</Text>
            </Surface>
          ) : null}

          <View style={{ gap: 4 }}>
            <Text variant="bodySmall" weight="medium" tone="secondary">{copy.packs.whoFor}</Text>
            <Text>{pack.audience}</Text>
          </View>

          <View style={{ gap: 8 }}>
            <Text variant="h4" accessibilityRole="header">{copy.packs.inPack}</Text>
            {rows.map((r) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
                <Text style={{ flex: 1 }}>{r.title}</Text>
                <Chip label={r.onShelf ? copy.packs.status.have : copy.packs.status.new} tone={r.onShelf ? 'success' : 'primary'} />
              </View>
            ))}
          </View>

          <View style={{ gap: 10 }}>
            <Text variant="h4" accessibilityRole="header">{copy.packs.howToStart}</Text>
            <Text tone="secondary">{pack.welcome}</Text>
            {pack.steps.map((s, i) => (
              <View key={s.title} style={{ flexDirection: 'row', gap: 12 }}>
                {/* A real sequence: numbered like an order-book slip (DIRECTION §7). */}
                <Text mono variant="caption" tone="mark" style={{ width: 48, paddingTop: 4 }} aria-hidden>{slipNumber(i + 1, 2, t('slip.no'))}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="semibold">{s.title}</Text>
                  <Text variant="bodySmall" tone="secondary">{s.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={{ gap: 6 }}>
            <Text variant="h4" accessibilityRole="header">{copy.packs.tips}</Text>
            {pack.tips.map((t) => <Text key={t} variant="bodySmall" tone="secondary">{t}</Text>)}
            {modes.length ? <Text variant="bodySmall" tone="secondary">{copy.packs.modesLine(modes)}</Text> : null}
          </View>

          <View accessibilityLiveRegion="polite" aria-live="polite" style={{ gap: 4 }}>
            {message ? <Text tone="success" weight="medium">{message}</Text> : null}
            {failed ? <Text tone="danger">{failed}</Text> : null}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

export interface StarterPacksProps {
  /** Apps were added from a pack. The caller usually opens the shelf. */
  onInstalled?: (apps: StoredApp[]) => void;
}

/** One card per vertical starter pack (docs/14 §20). Opening one shows who it is for, what is in it and how to start. */
export function StarterPacks({ onInstalled }: StarterPacksProps) {
  const [open, setOpen] = useState<StarterPack | null>(null);
  return (
    <View style={{ gap: 10 }}>
      {STARTER_PACKS.map((p) => <PackCard key={p.id} pack={p} onOpen={setOpen} />)}
      <PackSheet pack={open} onClose={() => setOpen(null)} onInstalled={(apps) => onInstalled?.(apps)} />
    </View>
  );
}
