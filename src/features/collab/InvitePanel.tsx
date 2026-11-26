import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { Copy, Link2, Send, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Share, View } from 'react-native';

import { invitableRoles, type Invite, type InviteRole, type Role, type Target } from '@/core/collab';
import { COLLAB_COPY, roleName } from './copy';
import { Button, SegmentedControl, Surface, Text, useKalamTheme } from '@/design';
import { getCollabService } from '@/infrastructure/collab/service';

const I = COLLAB_COPY.invite;
const DAYS = 7;
const USES = 10;

/** The link that opens the join screen with the code filled in (`kalam://join?c=…` or `https://…/join?c=…`). */
export const inviteLink = (code: string): string => Linking.createURL('join', { queryParams: { c: code } });

export interface InvitePanelProps {
  target: Target;
  myRole?: Role;
  /** App or team name, used in the message sent with the link. */
  title: string;
  onMessage?: (text: string) => void;
}

/** Create, send and cancel invites. Only roles below the person's own are offered. */
export function InvitePanel({ target, myRole, title, onMessage }: InvitePanelProps) {
  const theme = useKalamTheme();
  const roles = invitableRoles(myRole);
  const [role, setRole] = useState<InviteRole>(roles.includes('editor') ? 'editor' : roles[0] ?? 'viewer');
  const [code, setCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Invite[]>([]);
  const { kind, id } = target;

  const loadOpen = useCallback(async () => {
    const res = await getCollabService().invites({ kind, id });
    if (res.ok) setOpen(res.invites);
  }, [kind, id]);
  useEffect(() => {
    void loadOpen();
  }, [loadOpen]);

  if (!roles.length) return null;

  const create = async () => {
    setBusy(true);
    const res = await getCollabService().createInvite({ kind, id }, role, { days: DAYS, maxUses: USES });
    setBusy(false);
    if (!res.ok) {
      onMessage?.(res.message);
      return;
    }
    setCode(res.code);
    onMessage?.(I.created(DAYS, USES));
    void loadOpen();
  };
  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    onMessage?.(I.copied);
  };

  return (
    <View style={{ gap: theme.space[3] }} testID="collab-invite">
      <Text variant="h4" accessibilityRole="header">{I.heading}</Text>
      <SegmentedControl label={I.roleLabel} wrap options={roles.map((r) => ({ value: r, label: roleName(r) }))} value={role} onChange={setRole} />
      <Text variant="bodySmall" tone="secondary">{COLLAB_COPY.roles[role].description}.</Text>
      <Button label={I.create} icon={Link2} onPress={create} loading={busy} variant={code ? 'outline' : 'primary'} />

      {code ? (
        <Surface tone="alt" padded bordered>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="bodySmall" tone="secondary">{I.created(DAYS, USES)}</Text>
            <Text variant="caption" tone="secondary">{I.codeLabel}</Text>
            <Text mono selectable accessibilityLabel={`${I.codeLabel}: ${code}`}>{code}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              <Button label={I.send} icon={Send} onPress={() => void Share.share({ message: `${I.message(title)} ${inviteLink(code)}` }).catch(() => undefined)} />
              <Button label={I.copyLink} icon={Copy} variant="outline" onPress={() => void copy(inviteLink(code))} />
              <Button label={I.copyCode} icon={Copy} variant="outline" onPress={() => void copy(code)} />
            </View>
          </View>
        </Surface>
      ) : null}

      <Text weight="semibold">{I.openHeading}</Text>
      {open.length ? open.map((inv) => (
        <View key={inv.hash} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Text variant="bodySmall" style={{ flexShrink: 1 }}>
            {I.openLine(roleName(inv.role), inv.uses, inv.maxUses, new Date(inv.expiresAt).toLocaleDateString())}
          </Text>
          <Button
            label={I.cancel}
            icon={X}
            variant="ghost"
            onPress={async () => {
              const res = await getCollabService().revokeInvite({ kind, id }, inv.hash);
              onMessage?.(res.ok ? I.cancelled : res.message);
              if (res.ok) void loadOpen();
            }}
          />
        </View>
      )) : <Text variant="bodySmall" tone="secondary">{I.none}</Text>}
    </View>
  );
}
