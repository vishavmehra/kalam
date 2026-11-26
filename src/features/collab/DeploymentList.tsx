import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { type Deployment } from '@/core/collab';
import { COLLAB_COPY } from './copy';
import { Button, Text, useKalamTheme } from '@/design';
import { getCollabService } from '@/infrastructure/collab/service';

const D = COLLAB_COPY.deployment;

export interface DeploymentListProps {
  appId: string;
  /** Re-reads when this changes (the last sync time), so a new design version shows up. */
  refreshKey?: number;
}

/**
 * Which design version each person has (docs/14 §21.2 deployment status): people invited directly and
 * people who get the app through its team. Shown to the owner and admins only; nothing else is collected.
 */
export function DeploymentList({ appId, refreshKey }: DeploymentListProps) {
  const theme = useKalamTheme();
  const [data, setData] = useState<{ latest: number; people: Deployment[] } | undefined>();
  const [failed, setFailed] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    void getCollabService().deployment(appId).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setData({ latest: r.latest, people: r.people });
        setFailed(undefined);
      } else setFailed(r.message);
    });
    return () => {
      alive = false;
    };
  }, [appId, refreshKey, attempt]);

  return (
    <View style={{ gap: theme.space[2] }} testID="collab-deployment">
      <Text variant="h4" accessibilityRole="header">{D.heading}</Text>
      <Text variant="bodySmall" tone="secondary">{D.intro}</Text>
      {failed && !data ? (
        <View style={{ gap: theme.space[2] }}>
          <Text tone="danger" accessibilityRole="alert">{D.loadFailed} {failed}</Text>
          <Button label={COLLAB_COPY.tryAgain} variant="outline" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : !data ? (
        <ActivityIndicator color={theme.colors.primary} accessibilityLabel={COLLAB_COPY.loading} />
      ) : (
        <View style={{ gap: theme.space[1] }}>
          <Text variant="bodySmall">{D.latest(data.latest)}</Text>
          {data.people.map((p) => (
            <Text key={p.uid} variant="bodySmall">{D.line(p.name || COLLAB_COPY.members.unnamed, p.version, data.latest)}</Text>
          ))}
        </View>
      )}
    </View>
  );
}
