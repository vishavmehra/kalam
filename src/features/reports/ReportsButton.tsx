import { ChartColumn } from 'lucide-react-native';
import { useState } from 'react';

import type { KalamSpec } from '@/core/spec/schema';
import { Button } from '@/design';

import { COPY } from './copy';
import { hasReports, ReportsSheet } from './ReportsSheet';

/** Header button that opens Smart Reports for one app. Owns its own sheet state. Hidden when the app saves no entries. */
export function ReportsButton({ spec, appId }: { spec: KalamSpec; appId: string }) {
  const [open, setOpen] = useState(false);
  if (!hasReports(spec)) return null;
  return (
    <>
      <Button label={COPY.button} variant="ghost" size="sm" icon={ChartColumn} onPress={() => setOpen(true)} accessibilityHint={COPY.buttonHint} />
      <ReportsSheet spec={spec} appId={appId} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
