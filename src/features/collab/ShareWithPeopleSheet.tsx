import { LogOut, RefreshCw, Share2, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { canLeave, canManageMembers, canStopSharing, type AuditEntry, type LocalSpace, type LocalTeam, type Member } from '@/core/collab';
import { COLLAB_COPY, roleName } from './copy';
import type { KalamSpec } from '@/core/spec/schema';
import { announce, Button, Chip, Sheet, SwitchRow, Text, useKalamTheme } from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { useAuthUser } from '@/features/auth/use-auth';
import { getCollabService } from '@/infrastructure/collab/service';
import { ConflictList } from './ConflictList';
import { DeploymentList } from './DeploymentList';
import { InlineAsk } from './InlineAsk';
import { InvitePanel } from './InvitePanel';
import { MembersList } from './MembersList';
import { SyncStatusBadge } from './SyncStatusBadge';
import { useSpace, useTeams } from './use-collab';

const S = COLLAB_COPY.share;

export interface ShareWithPeopleSheetProps {
  appId: string;
  spec: KalamSpec;
  visible: boolean;
  onClose: () => void;
  /** The app left this device (the person left the shared app). Navigate away from it. */
  onLeft?: () => void;
}

/**
 * Share one app with people (docs/14 §17). Before sharing: what happens, sign-in, and an explicit yes,
 * per app. After: sync state, conflicts, people, invites, the team, recent changes, and leave or stop.
 */
export function ShareWithPeopleSheet({ appId, spec, visible, onClose, onLeft }: ShareWithPeopleSheetProps) {
  const theme = useKalamTheme();
  const space = useSpace(visible ? appId : '');
  const [notice, setNotice] = useState<string | undefined>();
  const say = useCallback((message: string) => {
    setNotice(message);
    announce(message);
  }, []);
  const close = () => {
    setNotice(undefined);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={close} title={S.title(spec.name)} description={space ? undefined : S.intro} maxWidth={620} testID="collab-share-sheet">
      <View style={{ gap: theme.space[4], paddingBottom: theme.space[6] }}>
        <View accessibilityLiveRegion="polite">{notice ? <Text weight="medium">{notice}</Text> : null}</View>
        {space === null ? (
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel={COLLAB_COPY.loading} />
        ) : space ? (
          <SharedView space={space} spec={spec} say={say} onLeft={() => { close(); onLeft?.(); }} />
        ) : (
          <NotShared appId={appId} say={say} active={visible} />
        )}
      </View>
    </Sheet>
  );
}

function NotShared({ appId, say, active }: { appId: string; say: (m: string) => void; active: boolean }) {
  const theme = useKalamTheme();
  const { user, restoring, configured } = useAuthUser();
  const teams = useTeams(active).filter((t) => canManageMembers(t.role));
  const [consent, setConsent] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    const res = await getCollabService().share(appId, { consent, teamId });
    setBusy(false);
    say(!res.ok ? res.message : res.teamError ? S.teamFailed(res.teamError) : S.done);
  };

  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="h4" accessibilityRole="header">{S.whatHappens}</Text>
      {S.points.map((p) => (
        <Text key={p} variant="bodySmall">{`• ${p}`}</Text>
      ))}
      {!configured ? (
        <Text tone="warning">{COLLAB_COPY.errors.not_set_up}</Text>
      ) : restoring ? (
        <ActivityIndicator color={theme.colors.primary} accessibilityLabel={COLLAB_COPY.loading} />
      ) : !user || user.isAnonymous ? (
        <View style={{ gap: theme.space[3] }}>
          <Text weight="medium">{user ? COLLAB_COPY.errors.guest_account : S.signInFirst}</Text>
          <SignInPanel initialMode={user ? 'signup' : 'signin'} />
        </View>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          <SwitchRow label={S.consent} value={consent} onValueChange={setConsent} testID="collab-consent" />
          {teams.length ? (
            <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel={S.teamLabel}>
              <Text variant="bodySmall" tone="secondary">{S.teamLabel}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                <Chip label={S.noTeam} role="radio" selected={teamId === null} onPress={() => setTeamId(null)} />
                {teams.map((t: LocalTeam) => (
                  <Chip key={t.teamId} label={t.name} role="radio" selected={teamId === t.teamId} onPress={() => setTeamId(t.teamId)} />
                ))}
              </View>
            </View>
          ) : null}
          <Button label={busy ? S.working : S.button} icon={Share2} onPress={share} loading={busy} disabled={!consent} testID="collab-share" />
        </View>
      )}
    </View>
  );
}

function SharedView({ space, spec, say, onLeft }: { space: LocalSpace; spec: KalamSpec; say: (m: string) => void; onLeft: () => void }) {
  const theme = useKalamTheme();
  const engine = getCollabService();
  const [names, setNames] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [asking, setAsking] = useState(false);
  const teams = useTeams(true).filter((t) => canManageMembers(t.role));
  const target = { kind: 'app' as const, id: space.sharedId };
  const nameOf = (uid: string) => (uid === space.myUid ? COLLAB_COPY.you : names[uid] || COLLAB_COPY.someone);
  const onLoaded = useCallback((list: Member[]) => setNames(Object.fromEntries(list.map((m) => [m.uid, m.name]))), []);

  useEffect(() => {
    let alive = true;
    void engine.history(space.localAppId, 10).then((r) => alive && r.ok && setHistory(r.entries));
    return () => {
      alive = false;
    };
  }, [engine, space.localAppId, space.lastSyncAt]);

  const syncNow = async () => {
    setSyncing(true);
    const r = await engine.sync(space.localAppId);
    setSyncing(false);
    say(r.error ? COLLAB_COPY.errors[r.error] : r.skipped ? S.syncedSkipped(r.skipped) : S.synced);
  };

  return (
    <View style={{ gap: theme.space[5] }}>
      <View style={{ gap: theme.space[2] }}>
        <Text>{S.yourRole(roleName(space.role))}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[2] }}>
          <SyncStatusBadge appId={space.localAppId} />
          <Button label={S.syncNow} icon={RefreshCw} variant="outline" onPress={syncNow} loading={syncing} />
        </View>
      </View>

      <ConflictList appId={space.localAppId} spec={spec} conflicts={space.conflicts} nameOf={nameOf} onMessage={say} />

      <View style={{ gap: theme.space[2] }}>
        <MembersList target={target} myRole={space.role} myUid={space.myUid} onMessage={say} onLoaded={onLoaded} />
        {space.teamId ? <Text variant="bodySmall" tone="secondary">{COLLAB_COPY.members.teamNote}</Text> : null}
      </View>

      {canManageMembers(space.role) ? <InvitePanel target={target} myRole={space.role} title={space.title} onMessage={say} /> : null}

      {canManageMembers(space.role) ? <DeploymentList appId={space.localAppId} refreshKey={space.lastSyncAt} /> : null}

      {canStopSharing(space.role) && (teams.length || space.teamId) ? (
        <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel={S.teamLabel}>
          <Text variant="bodySmall" tone="secondary">{S.teamLabel}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <Chip label={S.noTeam} role="radio" selected={!space.teamId} onPress={async () => {
              const r = await engine.setTeam(space.localAppId, null);
              say(r.ok ? COLLAB_COPY.teams.removedApp : r.message);
            }} />
            {teams.map((t) => (
              <Chip key={t.teamId} label={t.name} role="radio" selected={space.teamId === t.teamId} onPress={async () => {
                const r = await engine.setTeam(space.localAppId, t.teamId);
                say(r.ok ? COLLAB_COPY.teams.added : r.message);
              }} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: theme.space[2] }}>
        <Text variant="h4" accessibilityRole="header">{COLLAB_COPY.history.heading}</Text>
        {history.length ? history.map((e) => (
          <Text key={e.id} variant="bodySmall">{COLLAB_COPY.history.line(nameOf(e.actor), e.kind, new Date(e.at).toLocaleString())}</Text>
        )) : <Text variant="bodySmall" tone="secondary">{COLLAB_COPY.history.empty}</Text>}
      </View>

      {asking ? (
        canStopSharing(space.role) ? (
          <InlineAsk title={COLLAB_COPY.stop.title(space.title)} message={COLLAB_COPY.stop.message} confirmLabel={COLLAB_COPY.stop.confirm} destructive
            onCancel={() => setAsking(false)}
            onConfirm={async () => {
              const r = await engine.stopSharing(space.localAppId);
              setAsking(false);
              say(r.ok ? COLLAB_COPY.stop.done : r.message);
            }} />
        ) : (
          <InlineAsk title={COLLAB_COPY.leave.title(space.title)} message={COLLAB_COPY.leave.message} confirmLabel={COLLAB_COPY.leave.confirm} destructive
            onCancel={() => setAsking(false)}
            onConfirm={async () => {
              const r = await engine.leave(space.localAppId);
              setAsking(false);
              if (r.ok) {
                announce(COLLAB_COPY.leave.done);
                onLeft();
              } else say(r.message);
            }} />
        )
      ) : canStopSharing(space.role) ? (
        <Button label={COLLAB_COPY.stop.button} icon={Trash2} variant="destructive" onPress={() => setAsking(true)} />
      ) : canLeave(space.role) ? (
        <Button label={COLLAB_COPY.leave.button} icon={LogOut} variant="outline" onPress={() => setAsking(true)} />
      ) : null}
    </View>
  );
}
