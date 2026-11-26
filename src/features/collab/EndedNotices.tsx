import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { type EndedNotice } from '@/core/collab';
import { COLLAB_COPY } from './copy';
import { Button, Surface, Text, useKalamTheme } from '@/design';
import { getCollabService } from '@/infrastructure/collab/service';

/** Tells the person once that a shared app left this device because their access ended. For the shelf. */
export function EndedNotices() {
  const theme = useKalamTheme();
  const [notices, setNotices] = useState<EndedNotice[]>([]);
  useEffect(() => {
    const engine = getCollabService();
    let alive = true;
    const load = () => void engine.notices().then((n) => alive && setNotices(n), () => undefined);
    load();
    const off = engine.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  if (!notices.length) return null;
  return (
    <Surface tone="alt" padded bordered accessibilityLiveRegion="polite">
      <View style={{ gap: theme.space[2] }}>
        {notices.map((n) => <Text key={`${n.sharedId}${n.at}`}>{COLLAB_COPY.notices.ended(n.title)}</Text>)}
        <Button label={COLLAB_COPY.notices.dismiss} variant="outline" onPress={() => void getCollabService().clearNotices()} />
      </View>
    </Surface>
  );
}
