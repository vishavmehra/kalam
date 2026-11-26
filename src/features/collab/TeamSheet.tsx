import { ArrowLeft, Download, LogOut, Plus, Trash2, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { canChangeStructure, canManageMembers, type LocalSpace, type LocalTeam, type Role, type TeamApp } from '@/core/collab';
import { COLLAB_COPY, roleName } from './copy';
import { announce, Button, EmptyState, Sheet, Surface, Text, TextField, useKalamTheme } from '@/design';
import { useAuthUser } from '@/features/auth/use-auth';
import { getCollabService } from '@/infrastructure/collab/service';
import { InlineAsk } from './InlineAsk';
import { InvitePanel } from './InvitePanel';
import { MembersList } from './MembersList';
import { useTeams } from './use-collab';

const T = COLLAB_COPY.teams;

export interface TeamSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Opens an app that is on this device. */
  onOpenApp?: (localAppId: string) => void;
}

/**
 * Kalam for Teams (docs/14 §21): groups of people with a set of shared apps. Members get each app with
 * their team role; the owner of each app still decides its design. No usage reporting about members.
 */
export function TeamSheet({ visible, onClose, onOpenApp }: TeamSheetProps) {
  const theme = useKalamTheme();
  const teams = useTeams(visible);
  const [openId, setOpenId] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const say = useCallback((m: string) => {
    setNotice(m);
    announce(m);
  }, []);
  const open = teams.find((t) => t.teamId === openId);
  return (
    <Sheet visible={visible} onClose={onClose} title={open ? open.name : T.title} description={open ? undefined : T.intro} maxWidth={620} testID="collab-team-sheet">
      <View style={{ gap: theme.space[4], paddingBottom: theme.space[6] }}>
        <View accessibilityLiveRegion="polite">{notice ? <Text weight="medium">{notice}</Text> : null}</View>
        {open ? (
          <TeamDetail team={open} say={say} onBack={() => setOpenId(undefined)} onOpenApp={onOpenApp} />
        ) : (
          <TeamList teams={teams} say={say} onOpen={setOpenId} />
        )}
      </View>
    </Sheet>
  );
}

function TeamList({ teams, say, onOpen }: { teams: LocalTeam[]; say: (m: string) => void; onOpen: (id: string) => void }) {
  const theme = useKalamTheme();
  const { user } = useAuthUser();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const r = await getCollabService().createTeam(name);
    setBusy(false);
    if (r.ok) {
      say(T.created(name.trim()));
      setName('');
      onOpen(r.teamId);
    } else say(r.message);
  };
  return (
    <View style={{ gap: theme.space[4] }}>
      <Text variant="bodySmall" tone="secondary">{T.privacy}</Text>
      {teams.length ? teams.map((t) => (
        <Button key={t.teamId} label={`${t.name}, ${roleName(t.role).toLowerCase()}`} icon={Users} variant="outline" accessibilityHint={T.open(t.name)} onPress={() => onOpen(t.teamId)} />
      )) : <EmptyState title={T.empty} description={T.emptyHint} />}
      {user && !user.isAnonymous ? (
        <View style={{ gap: theme.space[2] }}>
          <TextField label={T.newLabel} value={name} onChangeText={setName} maxLength={60} />
          <Button label={T.create} icon={Plus} onPress={create} loading={busy} disabled={!name.trim()} />
        </View>
      ) : (
        <Text tone="secondary">{COLLAB_COPY.errors.sign_in}</Text>
      )}
    </View>
  );
}

function TeamDetail({ team, say, onBack, onOpenApp }: { team: LocalTeam; say: (m: string) => void; onBack: () => void; onOpenApp?: (id: string) => void }) {
  const theme = useKalamTheme();
  const engine = getCollabService();
  const [apps, setApps] = useState<(TeamApp & { localAppId?: string })[] | undefined>();
  const [role, setRole] = useState<Role>(team.role);
  const [mine, setMine] = useState<LocalSpace[]>([]);
  const [asking, setAsking] = useState(false);
  /** The team app the person pressed "Get this app" on: they read what it means before it is copied. */
  const [getting, setGetting] = useState<TeamApp | undefined>();
  const [failed, setFailed] = useState<string | undefined>();
  const target = { kind: 'team' as const, id: team.teamId };

  const load = useCallback(async () => {
    const r = await engine.team(team.teamId);
    if (r.ok) {
      setApps(r.apps);
      if (r.role) setRole(r.role);
      setFailed(undefined);
    } else setFailed(r.message);
    setMine((await engine.spaces()).filter((s) => canChangeStructure(s.role) && s.teamId !== team.teamId));
  }, [engine, team.teamId]);
  useEffect(() => {
    void load();
  }, [load]);

  const manager = canManageMembers(role);
  return (
    <View style={{ gap: theme.space[5] }}>
      <Button label={T.back} icon={ArrowLeft} variant="ghost" onPress={onBack} />
      {failed ? <Text tone="danger" accessibilityRole="alert">{failed}</Text> : null}

      <View style={{ gap: theme.space[2] }}>
        <Text variant="h4" accessibilityRole="header">{T.appsHeading}</Text>
        {!apps && !failed ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel={COLLAB_COPY.loading} /> : null}
        {apps && !apps.length ? <Text variant="bodySmall" tone="secondary">{T.noApps}</Text> : null}
        {apps?.map((a) => (
          <Surface key={a.sharedId} tone="alt" padded>
            <View style={{ gap: theme.space[2] }}>
              <Text weight="semibold">{a.title}</Text>
              {a.localAppId ? (
                <Button label={T.onShelf} variant="outline" onPress={() => onOpenApp?.(a.localAppId!)} />
              ) : getting?.sharedId === a.sharedId ? (
                <InlineAsk
                  title={T.getTitle(a.title)}
                  message={T.getMessage}
                  confirmLabel={T.getApp}
                  onCancel={() => setGetting(undefined)}
                  onConfirm={async () => {
                    const r = await engine.getTeamApp(a.sharedId, { consent: true });
                    setGetting(undefined);
                    say(r.ok ? T.gotApp : r.message);
                    if (r.ok) void load();
                  }}
                />
              ) : (
                <Button label={T.getApp} icon={Download} accessibilityHint={a.title} onPress={() => setGetting(a)} />
              )}
            </View>
          </Surface>
        ))}
        {manager && mine.length ? (
          <View style={{ gap: theme.space[2] }}>
            <Text weight="semibold">{T.addHeading}</Text>
            {mine.map((s) => (
              <Button key={s.localAppId} label={T.add(s.title)} icon={Plus} variant="outline" onPress={async () => {
                const r = await engine.setTeam(s.localAppId, team.teamId);
                say(r.ok ? T.added : r.message);
                if (r.ok) void load();
              }} />
            ))}
          </View>
        ) : null}
      </View>

      <MembersList target={target} myRole={role} myUid={team.myUid} onMessage={say} />
      {manager ? <InvitePanel target={target} myRole={role} title={team.name} onMessage={say} /> : null}

      {asking ? (
        <InlineAsk
          title={role === 'owner' ? T.deleteTitle(team.name) : T.leaveTitle(team.name)}
          message={role === 'owner' ? T.deleteMessage : T.leaveMessage}
          confirmLabel={role === 'owner' ? T.delete : T.leave}
          destructive
          onCancel={() => setAsking(false)}
          onConfirm={async () => {
            const r = role === 'owner' ? await engine.deleteTeam(team.teamId) : await engine.leaveTeam(team.teamId);
            setAsking(false);
            say(r.ok ? (role === 'owner' ? T.deleted : T.left) : r.message);
            if (r.ok) {
              onBack();
              void engine.syncAll();
            }
          }}
        />
      ) : (
        <Button label={role === 'owner' ? T.delete : T.leave} icon={role === 'owner' ? Trash2 : LogOut} variant={role === 'owner' ? 'destructive' : 'outline'} onPress={() => setAsking(true)} />
      )}
    </View>
  );
}
