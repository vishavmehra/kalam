import { router } from 'expo-router';

import { routes } from '@/components/shell/routes';
import { Button, EmptyState, Logo, PageIllustration, Screen } from '@/design';

/** Unknown routes. */
export default function NotFound() {
  return (
    <Screen maxWidth={640} safeBottom>
      <Logo size={32} />
      <EmptyState
        illustration={<PageIllustration />}
        title="This page isn't on your shelf"
        description="The link may be old, or the app it pointed to was deleted from this device."
        action={<Button label="Go to your shelf" onPress={() => router.replace(routes.shelf)} />}
      />
    </Screen>
  );
}
