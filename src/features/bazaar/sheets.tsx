import { useState } from 'react';
import { View } from 'react-native';

import { priceLabel, REPORT_REASONS, type BazaarListing, type ReportReason } from '@/core/bazaar';
import type { BazaarUpdateCheck, KalamUser } from '@/core/contracts';
import { Button, Chip, Sheet, Text, TextField } from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';

/** Asks for an account only at the moment one is needed (like, report). Guests are allowed. */
export function SignInSheet({ visible, reason, onClose, onDone }: {
  visible: boolean;
  reason: string;
  onClose: () => void;
  onDone: (user: KalamUser) => void;
}) {
  return (
    <Sheet visible={visible} title="Sign in to continue" description={reason} onClose={onClose}>
      <SignInPanel allowGuest onDone={onDone} />
    </Sheet>
  );
}

const REASON_LABELS: Record<ReportReason, string> = {
  malicious: 'Harmful or unsafe',
  misleading: 'Misleading description',
  privacy: 'Asks for private information',
  copyright: 'Copied without credit',
  spam: 'Spam',
  inappropriate: 'Inappropriate content',
  broken: 'Does not work',
};

export function ReportSheet({ visible, title, onClose, onSend }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSend: (reason: ReportReason, note: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      visible={visible}
      title={`Report "${title}"`}
      description="Tell us what is wrong. Your report is private. The maker does not see who sent it."
      onClose={onClose}
      footer={
        <Button
          label="Send report"
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
        <View role="radiogroup" accessibilityLabel="Reason" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REPORT_REASONS.map((r) => (
            <Chip key={r} label={REASON_LABELS[r]} role="radio" selected={reason === r} onPress={() => setReason(r)} />
          ))}
        </View>
        <TextField label="Details (optional)" value={note} onChangeText={setNote} multiline maxLength={500} numberOfLines={3} />
        <Text variant="bodySmall" tone="muted">Reports are saved for the Kalam team to review. Sending one does not remove the app straight away.</Text>
      </View>
    </Sheet>
  );
}

/** Purchase confirmation (docs/12 §12.3): name, maker, price, balance before and after. */
export function PurchaseSheet({ visible, listing, credits, onClose, onConfirm }: {
  visible: boolean;
  listing: BazaarListing;
  /** Current balance, or undefined when the wallet has not been opened yet (it starts with 100). */
  credits: number | undefined;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const balance = credits ?? 100;
  const after = balance - listing.price;
  return (
    <Sheet
      visible={visible}
      title={`Buy "${listing.title}"?`}
      description="Credits are a test currency inside Kalam. No real money is charged."
      onClose={onClose}
      footer={
        <Button
          label={`Pay ${priceLabel(listing.price)}`}
          disabled={busy || after < 0}
          loading={busy}
          onPress={async () => { setBusy(true); await onConfirm(); setBusy(false); }}
        />
      }
    >
      <View style={{ gap: 8 }}>
        <Line label="App" value={listing.title} />
        <Line label="Maker" value={listing.makerName} />
        <Line label="Price" value={priceLabel(listing.price)} />
        <Line label="Your credits" value={credits === undefined ? '100 (your starting credits)' : String(balance)} />
        <Line label="After buying" value={String(after)} />
        {after < 0 ? <Text tone="danger">You do not have enough credits for this app.</Text> : null}
        <Text variant="bodySmall" tone="muted">Nothing is charged until the purchase is confirmed by Kalam Bazaar.</Text>
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
  const [busy, setBusy] = useState(false);
  const run = async (mode: 'replace' | 'copy') => { setBusy(true); await onApply(mode); setBusy(false); };
  return (
    <Sheet
      visible={visible}
      title={`Version ${check.listing?.specVersion ?? ''} is available`}
      description={check.localEdits
        ? 'You changed your copy. To keep your changes, install the update as a separate app.'
        : 'Your entries stay. The old design stays in the app history, so you can go back.'}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label="Keep my version" variant="ghost" onPress={onClose} disabled={busy} />
          {check.localEdits ? null : <Button label="Update my copy" onPress={() => run('replace')} loading={busy} />}
          <Button label="Install as a separate app" variant={check.localEdits ? 'primary' : 'outline'} onPress={() => run('copy')} loading={busy} />
        </View>
      }
    >
      <View style={{ gap: 6 }}>
        {check.listing?.changeSummary ? <Text>From the maker: {check.listing.changeSummary}</Text> : null}
        <Text weight="semibold">What is different</Text>
        {check.changes.length
          ? check.changes.slice(0, 12).map((c) => <Text key={c} tone="secondary">{c}</Text>)
          : <Text tone="secondary">{check.message ?? 'Only small details changed.'}</Text>}
      </View>
    </Sheet>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Text tone="secondary" style={{ width: 120 }}>{label}</Text>
      <Text style={{ flex: 1 }}>{value}</Text>
    </View>
  );
}
