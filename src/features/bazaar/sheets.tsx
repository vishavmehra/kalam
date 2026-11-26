import { useState } from 'react';
import { View } from 'react-native';

import { REPORT_REASONS, type BazaarListing, type ReportReason } from '@/core/bazaar';
import type { BazaarUpdateCheck, KalamUser } from '@/core/contracts';
import { Button, Chip, Sheet, Text, TextField, useKalamTheme } from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';

import { priceText } from './parts';

/** Sign-in for a stale guest session: like, report and buy need a Google or email account. */
export function SignInSheet({ visible, reason, onClose, onDone }: {
  visible: boolean;
  reason: string;
  onClose: () => void;
  onDone: (user: KalamUser) => void;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <Sheet visible={visible} title={t('bazaar.signIn.title')} description={reason} onClose={onClose}>
      <SignInPanel initialMode="signup" onDone={onDone} />
    </Sheet>
  );
}

const REASON: Record<ReportReason, TranslationKey> = {
  malicious: 'bazaar.report.reason.malicious',
  misleading: 'bazaar.report.reason.misleading',
  privacy: 'bazaar.report.reason.privacy',
  copyright: 'bazaar.report.reason.copyright',
  spam: 'bazaar.report.reason.spam',
  inappropriate: 'bazaar.report.reason.inappropriate',
  broken: 'bazaar.report.reason.broken',
};

export function ReportSheet({ visible, title, onClose, onSend }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSend: (reason: ReportReason, note: string) => Promise<void>;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      visible={visible}
      title={t('bazaar.report.title', { name: title })}
      description={t('bazaar.report.description')}
      onClose={onClose}
      footer={
        <Button
          label={t('bazaar.report.send')}
          disabled={!reason || busy}
          loading={busy}
          onPress={async () => {
            if (!reason) return;
            setBusy(true);
            await onSend(reason, note);
            setBusy(false);
            setReason(null);
            setNote('');
          }}
        />
      }
    >
      <View style={{ gap: 16 }}>
        <View role="radiogroup" accessibilityLabel={t('bazaar.report.reason.label')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REPORT_REASONS.map((r) => (
            <Chip key={r} label={t(REASON[r])} role="radio" selected={reason === r} onPress={() => setReason(r)} />
          ))}
        </View>
        <TextField label={t('bazaar.report.details')} value={note} onChangeText={setNote} multiline maxLength={500} numberOfLines={3} />
        <Text variant="bodySmall" tone="muted">{t('bazaar.report.note')}</Text>
      </View>
    </Sheet>
  );
}

/** Purchase confirmation (docs/12 §12.3): name, maker, price, balance before and after. Only when payments are on. */
export function PurchaseSheet({ visible, listing, credits, onClose, onConfirm }: {
  visible: boolean;
  listing: BazaarListing;
  /** Current balance, or undefined when the wallet has not been opened yet (it starts with 100). */
  credits: number | undefined;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [busy, setBusy] = useState(false);
  const balance = credits ?? 100;
  const after = balance - listing.price;
  return (
    <Sheet
      visible={visible}
      title={t('bazaar.buy.title', { name: listing.title })}
      description={t('bazaar.buy.description')}
      onClose={onClose}
      footer={
        <Button
          label={t('bazaar.buy.pay', { price: priceText(t, listing.price) })}
          disabled={busy || after < 0}
          loading={busy}
          onPress={async () => { setBusy(true); await onConfirm(); setBusy(false); }}
        />
      }
    >
      <View style={{ gap: 8 }}>
        <Line label={t('bazaar.buy.app')} value={listing.title} />
        <Line label={t('bazaar.buy.maker')} value={listing.makerName} />
        <Line label={t('bazaar.buy.price')} value={priceText(t, listing.price)} mono />
        <Line label={t('bazaar.buy.balance')} value={credits === undefined ? t('bazaar.buy.starting') : String(balance)} mono />
        <Line label={t('bazaar.buy.after')} value={String(after)} mono />
        {after < 0 ? <Text tone="danger">{t('bazaar.buy.notEnough')}</Text> : null}
        <Text variant="bodySmall" tone="muted">{t('bazaar.buy.note')}</Text>
      </View>
    </Sheet>
  );
}

/** Update choices (docs/12 §10.3-10.4): review, install, keep. Local changes are never discarded. */
export function UpdateSheet({ visible, check, onClose, onApply }: {
  visible: boolean;
  check: BazaarUpdateCheck;
  onClose: () => void;
  onApply: (mode: 'replace' | 'copy') => Promise<void>;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [busy, setBusy] = useState(false);
  const run = async (mode: 'replace' | 'copy') => { setBusy(true); await onApply(mode); setBusy(false); };
  return (
    <Sheet
      visible={visible}
      title={t('bazaar.update.title', { version: check.listing?.specVersion ?? '' })}
      description={t(check.localEdits ? 'bazaar.update.edited' : 'bazaar.update.safe')}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label={t('bazaar.update.keep')} variant="ghost" onPress={onClose} disabled={busy} />
          {check.localEdits ? null : <Button label={t('bazaar.update.replace')} onPress={() => run('replace')} loading={busy} />}
          <Button label={t('bazaar.update.copy')} variant={check.localEdits ? 'primary' : 'outline'} onPress={() => run('copy')} loading={busy} />
        </View>
      }
    >
      <View style={{ gap: 6 }}>
        {check.listing?.changeSummary ? <Text>{t('bazaar.update.fromMaker', { summary: check.listing.changeSummary })}</Text> : null}
        <Text weight="semibold">{t('bazaar.update.different')}</Text>
        {check.changes.length
          ? check.changes.slice(0, 12).map((c) => <Text key={c} tone="secondary">{c}</Text>)
          : <Text tone="secondary">{check.message ?? t('bazaar.update.small')}</Text>}
      </View>
    </Sheet>
  );
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Text tone="secondary" style={{ width: 120 }}>{label}</Text>
      <Text mono={mono} style={{ flex: 1 }}>{value}</Text>
    </View>
  );
}
