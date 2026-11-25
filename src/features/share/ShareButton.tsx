import { Share2 } from 'lucide-react-native';
import { useState } from 'react';

import type { KalamSpec } from '@/core/spec/schema';
import { Button, IconButton } from '@/design';
import { SHARE_UI } from './copy';
import { ShareLinksSheet } from './ShareLinksSheet';

/**
 * Header button that opens the sharing sheet for one app. Owns its own sheet state.
 * `compact` shows an icon only, for phones where the app name needs the room.
 */
export function ShareButton({ spec, appId, compact }: { spec: KalamSpec; appId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <IconButton icon={Share2} label={SHARE_UI.button} onPress={() => setOpen(true)} />
      ) : (
        <Button label={SHARE_UI.button} variant="ghost" icon={Share2} onPress={() => setOpen(true)} accessibilityHint={SHARE_UI.buttonHint} />
      )}
      <ShareLinksSheet spec={spec} appId={appId} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
