import gsap from 'gsap';
import { type ComponentRef, type RefObject, useEffect, useRef } from 'react';
import type { View } from 'react-native';

/**
 * Web: one staggered rise of the shelf cards the first time they appear (never on search or
 * re-render — motion only where it orients). Transform + opacity only; reverted on unmount.
 */
export function useCardEntrance(container: RefObject<ComponentRef<typeof View> | null>, ready: boolean, reduced: boolean): void {
  const played = useRef(false);
  useEffect(() => {
    const el = container.current as unknown as HTMLElement | null;
    if (!ready || played.current || reduced || !el) return;
    played.current = true;
    const ctx = gsap.context(() => {
      gsap.from('[data-k-card]', {
        y: 14, opacity: 0, duration: 0.42, ease: 'power3.out', stagger: { each: 0.04, from: 'start' }, clearProps: 'transform,opacity',
      });
    }, el);
    return () => ctx.revert();
  }, [container, ready, reduced]);
}
