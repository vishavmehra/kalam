/**
 * Sheet panel style at enter progress `p` (0 hidden, 1 shown). Every branch sets the same keys:
 * Reanimated keeps the first run's value for any key a later run leaves out. A sheet first rendered
 * before reduced motion was known kept `translateY` from that run and stayed pushed off screen.
 */
export function sheetPanelStyle(p: number, sheetH: number, reduced: boolean, isDesktop: boolean) {
  'worklet';
  if (reduced) return { opacity: p, transform: [{ translateY: 0 }, { scale: 1 }] };
  if (isDesktop) return { opacity: p, transform: [{ translateY: 0 }, { scale: 0.96 + 0.04 * p }] };
  return { opacity: 1, transform: [{ translateY: (1 - p) * sheetH }, { scale: 1 }] };
}
