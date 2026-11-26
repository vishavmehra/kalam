import { LogIn } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { COLLAB_COPY } from './copy';
import { announce, Button, Sheet, SwitchRow, Text, TextField, useKalamTheme } from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { useAuthUser } from '@/features/auth/use-auth';
import { getCollabService } from '@/infrastructure/collab/service';

const J = COLLAB_COPY.join;

export type JoinOutcome = { kind: 'app'; localAppId: string } | { kind: 'team'; teamId: string };

export interface JoinSheetProps {
  visible: boolean;
  onClose: () => void;
  /** From an invite link (`/join?c=…`). The person still presses Join: opening a link never joins by itself. */
  initialCode?: string;
  onJoined?: (outcome: JoinOutcome) => void;
}

/**
 * Join a shared app or a team with an invite link or code. Signing in happens here, only when needed.
 * Before joining, the person reads what joining does (entries sync through the cloud and others see them,
 * history records who changed what, photos stay here) and says yes; the engine refuses without that yes.
 */
export function JoinSheet({ visible, onClose, initialCode, onJoined }: JoinSheetProps) {
  const theme = useKalamTheme();
  const { user, configured } = useAuthUser();
  // Until the person types, the field shows the code from the link.
  const [typed, setCode] = useState<string | undefined>();
  const code = typed ?? initialCode ?? '';
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | undefined>();

  const join = async () => {
    setBusy(true);
    setMessage(undefined);
    const res = await getCollabService().join(code, { consent });
    setBusy(false);
    if (!res.ok) {
      setMessage({ text: res.message, error: true });
      return;
    }
    const teamName = res.kind === 'team' ? (await getCollabService().teams()).find((t) => t.teamId === res.teamId)?.name ?? '' : '';
    const text = res.kind === 'app' ? J.joinedApp : J.joinedTeam(teamName);
    setMessage({ text, error: false });
    announce(text);
    setCode('');
    onJoined?.(res.kind === 'app' ? { kind: 'app', localAppId: res.localAppId } : { kind: 'team', teamId: res.teamId });
  };

  const needsAccount = !user || user.isAnonymous;
  return (
    <Sheet visible={visible} onClose={onClose} title={J.title} description={J.intro} testID="collab-join-sheet">
      <View style={{ gap: theme.space[4], paddingBottom: theme.space[6] }}>
        {!configured ? <Text tone="warning">{COLLAB_COPY.errors.not_set_up}</Text> : null}
        <TextField label={J.label} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />
        {message ? (
          <Text tone={message.error ? 'danger' : 'success'} accessibilityRole={message.error ? 'alert' : undefined}>{message.text}</Text>
        ) : null}
        {configured && needsAccount ? (
          <View style={{ gap: theme.space[3] }}>
            <Text weight="medium">{user ? COLLAB_COPY.errors.guest_account : J.signInFirst}</Text>
            <SignInPanel initialMode={user ? 'signup' : 'signin'} />
          </View>
        ) : (
          <View style={{ gap: theme.space[3] }}>
            <Text variant="h4" accessibilityRole="header">{J.noticeHeading}</Text>
            {J.notice.map((p) => (
              <Text key={p} variant="bodySmall">{`• ${p}`}</Text>
            ))}
            <SwitchRow label={J.consent} value={consent} onValueChange={setConsent} testID="collab-join-consent" />
            <Button label={busy ? J.working : J.button} icon={LogIn} onPress={join} loading={busy} disabled={!code.trim() || !configured || !consent} testID="collab-join" />
          </View>
        )}
      </View>
    </Sheet>
  );
}
