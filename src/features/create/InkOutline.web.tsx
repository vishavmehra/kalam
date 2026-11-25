/**
 * Web creation animation: a GSAP timeline inks an app outline stroke by stroke while Kalam
 * builds (the one expressive motion moment of the flow). Reduced motion → static outline.
 */
import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { useKalamTheme, useReducedMotion } from '@/design';
import { INK_PATHS, INK_VIEWBOX } from './ink-paths';

export function InkOutline({ size = 120, active = true }: { size?: number; active?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();
  const { colors } = useKalamTheme();

  useEffect(() => {
    const root = ref.current;
    if (!root || reduced || !active) return;
    const ctx = gsap.context(() => {
      const paths = gsap.utils.toArray<SVGPathElement>('path', root);
      paths.forEach((p, i) => gsap.set(p, { strokeDasharray: INK_PATHS[i]!.len, strokeDashoffset: INK_PATHS[i]!.len }));
      gsap.timeline({ repeat: -1, repeatDelay: 0.25 })
        .to(paths, { strokeDashoffset: 0, duration: 0.42, ease: 'power2.inOut', stagger: 0.2 })
        .to(root, { opacity: 0.18, duration: 0.45, ease: 'power1.in' }, '+=0.7')
        .set(paths, { strokeDashoffset: (i: number) => INK_PATHS[i]!.len })
        .set(root, { opacity: 1 });
    }, root);
    return () => ctx.revert();
  }, [reduced, active]);

  return (
    <svg
      ref={ref}
      viewBox={INK_VIEWBOX}
      width={size}
      height={size * 1.5}
      role="img"
      aria-label="Kalam is sketching your app"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {INK_PATHS.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={i === INK_PATHS.length - 1 ? colors.accent : colors.primary}
          strokeWidth={p.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
