import { UserMinus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { canAssign, canRemove, INVITE_ROLES, type Member, type Role, type Target } from '@/core/collab';
import { COLLAB_COPY, roleName } from './copy';
import { Button, SegmentedControl, Text, useKalamTheme } from '@/design';
import { getCollabService } from '@/infrastructure/collab/service';
import { InlineAsk } from './InlineAsk';

const M = COLLAB_COPY.members;

export interface MembersListProps {
  target: Target;
  myRole?: Role;
  myUid?: string;
  /** Reports what happened, for the sheet's live message line. */
  onMessage?: (text: string) => void;
  /** Called with the loaded list (the sheet uses it to name people in conflicts and history). */
  onLoaded?: (members: Member[]) => void;
}

/** Who is in a shared app or team, with role changes and removal for those allowed (docs/14 §17.3, §21.2). */
export function MembersList({ target, myRole, myUid, onMessage, onLoaded }: MembersListProps) {
  const theme = useKalamTheme();
  const [members, setMembers] = useState<Member[] | undefined>();
  const [failed, setFailed] = useState<string | undefined>();
  const [asking, setAsking] = useState<Member | undefined>();

  // Parents pass inline objects and callbacks: key the load on the ids only, so it never loops.
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  });
  const { kind, id } = target;
  const load = useCallback(async () => {
    const res = await getCollabService().members({ kind, id });
    if (res.ok) {
      setMembers(res.members);
      setFailed(undefined);
      loaded.current?.(res.members);
    } else setFailed(res.message);
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (m: Member) => m.name || M.unnamed;

  if (failed && !members) {
    return (
      <View style={{ gap: theme.space[2] }}>
        <Text tone="danger" accessibilityRole="alert">{M.loadFailed} {failed}</Text>
        <Button label={COLLAB_COPY.tryAgain} variant="outline" onPress={() => void load()} />
      </View>
    );
  }
  if (!members) return <ActivityIndicator color={theme.colors.primary} accessibilityLabel={COLLAB_COPY.loading} />;

  return (
    <View style={{ gap: theme.space[3] }} testID="collab-members">
      <Text variant="h4" accessibilityRole="header">{M.heading}</Text>
      {members.map((m) => {
        const me = m.uid === myUid;
        const roles = INVITE_ROLES.filter((r) => r === m.role || canAssign(myRole, m.role, r));
        const editable = !me && roles.length > 1;
        return (
          <View key={m.uid} style={{ gap: theme.space[2], paddingVertical: theme.space[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Text weight="semibold">{me ? M.you(nameOf(m)) : nameOf(m)}</Text>
            <Text variant="bodySmall" tone="secondary">
              {roleName(m.role)}. {COLLAB_COPY.roles[m.role].description}.
            </Text>
            {editable ? (
              <SegmentedControl
                label={M.changeRole(nameOf(m))}
                labelHidden
                wrap
                options={roles.map((r) => ({ value: r, label: roleName(r) }))}
                value={m.role}
                onChange={async (role) => {
                  const res = await getCollabService().setRole(target, m, role);
                  onMessage?.(res.ok ? M.roleChanged(nameOf(m), roleName(role)) : res.message);
                  if (res.ok) await load();
                }}
              />
            ) : null}
            {!me && canRemove(myRole, m.role) ? (
              asking?.uid === m.uid ? (
                <InlineAsk
                  title={M.removeTitle(nameOf(m))}
                  message={M.removeMessage}
                  confirmLabel={M.remove(nameOf(m))}
                  destructive
                  onCancel={() => setAsking(undefined)}
                  onConfirm={async () => {
                    const res = await getCollabService().removeMember(target, m);
                    setAsking(undefined);
                    onMessage?.(res.ok ? M.removed(nameOf(m)) : res.message);
                    if (res.ok) await load();
                  }}
                />
              ) : (
                <Button label={M.remove(nameOf(m))} icon={UserMinus} variant="ghost" onPress={() => setAsking(m)} />
              )
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
