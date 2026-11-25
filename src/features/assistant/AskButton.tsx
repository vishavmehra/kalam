import { MessageCircleQuestion } from 'lucide-react-native';
import { useState } from 'react';

import type { KalamSpec } from '@/core/spec/schema';
import { Button } from '@/design';

import { AssistantSheet } from './AssistantSheet';

/** Header button that opens the App Assistant for one app. Owns its own sheet state. */
export function AskButton({ spec, appId }: { spec: KalamSpec; appId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label="Ask" variant="ghost" size="sm" icon={MessageCircleQuestion} onPress={() => setOpen(true)} accessibilityHint="Ask a question about this app" />
      <AssistantSheet spec={spec} appId={appId} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
