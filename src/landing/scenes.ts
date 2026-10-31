import { useEffect, useRef } from 'react';

// Scroll-linked scenes for the landing page (the reference video's motion is driven by the scroll, not by timers).
// A scene is a tall block with a sticky, full-height stage inside; its progress p runs 0 → 1 while the stage is pinned.
// Callbacks write styles straight onto elements (no React render per frame).

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Progress of p through [a, b], clamped to 0..1 */
export const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

type Frame = (p: number, vh: number, vw: number) => void;

function useScrollFrame(
  el: React.RefObject<HTMLElement | null>,
  scroller: React.RefObject<HTMLElement | null>,
  progressOf: (top: number, height: number, vh: number) => number,
  frame: Frame
) {
  const cb = useRef(frame);
  cb.current = frame;
  useEffect(() => {
    const sc = scroller.current;
    const node = el.current;
    if (!sc || !node) return;
    let raf = 0;
    let last = -1;
    let lastW = 0;
    let lastH = 0;
    const run = () => {
      raf = 0;
      const vh = sc.clientHeight;
      const vw = sc.clientWidth;
      const top = node.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      const p = progressOf(top, node.offsetHeight, vh);
      // Off-screen scenes sit at 0 or 1: write them once, then skip until something changes
      if (p === last && vw === lastW && vh === lastH && (p === 0 || p === 1)) return;
      last = p;
      lastW = vw;
      lastH = vh;
      cb.current(p, vh, vw);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    run();
    sc.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      sc.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Pinned scene: p = how far the sticky stage has travelled through its tall parent */
export function useScene(el: React.RefObject<HTMLElement | null>, scroller: React.RefObject<HTMLElement | null>, frame: Frame) {
  useScrollFrame(el, scroller, (top, height, vh) => {
    const total = height - vh;
    return total > 0 ? clamp01(-top / total) : top <= 0 ? 1 : 0;
  }, frame);
}

/** Entering block (not pinned): p goes 0 → 1 as its top rises from the bottom of the screen to 15% from the top */
export function useEnter(el: React.RefObject<HTMLElement | null>, scroller: React.RefObject<HTMLElement | null>, frame: Frame) {
  useScrollFrame(el, scroller, (top, _h, vh) => clamp01((vh - top) / (vh * 0.85)), frame);
}
