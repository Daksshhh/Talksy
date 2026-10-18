import { useEffect } from 'react';

/**
 * Keeps --vvh equal to the *visual* viewport height so the chat composer stays
 * above the on-screen keyboard on iOS Safari (which doesn't resize layout viewport).
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
}
