import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { routes } from '@/components/shell/routes';
import { useKalamTheme } from '@/design';
import { JoinSheet } from '@/features/collab';

/** /join?c=CODE: an invite link (kalam://join?c=… or https://<site>/join?c=…). Opening a link only fills the code; the person still presses Join. */
export default function JoinRoute() {
  const { c } = useLocalSearchParams<{ c?: string }>();
  const background = useKalamTheme().colors.background;
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <JoinSheet
        visible
        initialCode={typeof c === 'string' ? c : undefined}
        onClose={() => router.replace(routes.shelf)}
        onJoined={(r) => router.replace(r.kind === 'app' ? routes.app(r.localAppId) : routes.shelf)}
      />
    </View>
  );
}
