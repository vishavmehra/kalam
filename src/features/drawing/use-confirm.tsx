/** One confirmation sheet per component: `const [node, ask] = useConfirm();` then render `{node}` and call `ask({...})`. */
import { useState, type ReactNode } from 'react';
import { ConfirmSheet } from '@/design';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Names the action ("Clear screen"), never "OK". */
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function useConfirm(): [ReactNode, (options: ConfirmOptions) => void] {
  const [state, setState] = useState<{ options?: ConfirmOptions; open: boolean }>({ open: false });
  const close = () => setState((s) => ({ ...s, open: false }));
  const node = state.options ? (
    <ConfirmSheet
      visible={state.open}
      title={state.options.title}
      message={state.options.message}
      confirmLabel={state.options.confirmLabel}
      destructive={state.options.destructive}
      onConfirm={() => { close(); state.options?.onConfirm(); }}
      onCancel={close}
    />
  ) : null;
  return [node, (options) => setState({ options, open: true })];
}
