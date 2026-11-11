import { useEffect } from 'react';

export default function useMatrixScroll(containerRef, version) {
  useEffect(() => {
    const container = containerRef.current;
    const table = container?.querySelector('table');
    if (!table) return;
    let frame, idle, pointerDown = false, samples = [];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const rtl = getComputedStyle(container).direction === 'rtl';
    const read = () => rtl ? -container.scrollLeft : container.scrollLeft;
    const write = value => { container.scrollLeft = rtl ? -value : value; };
    const cancel = () => { cancelAnimationFrame(frame); frame = undefined; clearTimeout(idle); };
    const paint = () => {
      const overflow = container.scrollWidth > container.clientWidth + 1;
      const stage = parseFloat(getComputedStyle(table).getPropertyValue('--ib-stage-width')) || 88;
      const progress = overflow ? Math.min(1, read() / Math.max(1, stage * 1.5)) : 0;
      container.style.setProperty('--ib-rail-shrink', (Math.max(0, stage - Math.max(68, stage * .7)) * progress).toFixed(3) + 'px');
      container.style.setProperty('--ib-rail-progress', String(progress));
    };
    const targets = () => {
      const headers = [...table.querySelectorAll('th.ib-config-header')];
      const rail = table.querySelector('.name-column')?.getBoundingClientRect().width || 0;
      const origin = container.getBoundingClientRect();
      const current = read(), max = Math.max(0, container.scrollWidth - container.clientWidth);
      return [...new Set([0, ...headers.map(header => {
        const rect = header.getBoundingClientRect();
        const distance = rtl ? origin.right - rect.right : rect.left - origin.left;
        return Math.max(0, Math.min(max, current + distance - rail));
      }), max])].sort((a,b) => a-b);
    };
    const settle = () => {
      if (pointerDown || frame !== undefined || !container.getClientRects().length) return;
      const stops = targets(), start = read();
      if (stops.length < 2) return;
      const recent = samples.filter(sample => performance.now() - sample.time < 260);
      const first = recent[0], last = recent.at(-1);
      const velocity = first && last && last.time > first.time ? (last.x - first.x) / (last.time - first.time) : 0;
      const projected = start + Math.max(-36, Math.min(36, velocity * 80));
      const end = stops.reduce((best, value) => Math.abs(value - projected) < Math.abs(best - projected) ? value : best, stops[0]);
      if (Math.abs(end - start) < .75) return;
      if (reduced.matches) { write(end); paint(); return; }
      const began = performance.now(), duration = Math.min(700, 420 + Math.abs(end - start) * 3);
      const tick = now => {
        const t = Math.min(1, (now - began) / duration);
        write(start + (end - start) * (1 - Math.pow(1 - t, 3)));
        paint();
        if (t < 1) frame = requestAnimationFrame(tick);
        else { frame = undefined; samples = []; }
      };
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => { clearTimeout(idle); if (!pointerDown && frame === undefined) idle = setTimeout(settle, 180); };
    const scroll = () => {
      paint();
      if (frame === undefined) {
        const now = performance.now();
        samples = [...samples.filter(sample => now - sample.time < 260), {x:read(), time:now}];
        schedule();
      }
    };
    const down = () => { cancel(); pointerDown = true; samples = []; };
    const up = () => { if (pointerDown) { pointerDown = false; schedule(); } };
    const wheel = () => { cancel(); schedule(); };
    const key = event => { if (['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)) wheel(); };
    const resize = new ResizeObserver(() => { cancel(); samples = []; paint(); schedule(); });
    resize.observe(container);
    const mutations = new MutationObserver(() => { paint(); });
    mutations.observe(table, {attributes:true, attributeFilter:['style']});
    container.classList.add('ib-scroll-morph');
    paint();
    container.addEventListener('scroll', scroll, {passive:true});
    container.addEventListener('pointerdown', down, {passive:true});
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    container.addEventListener('wheel', wheel, {passive:true});
    container.addEventListener('keydown', key);
    return () => {
      cancel(); resize.disconnect(); mutations.disconnect();
      container.removeEventListener('scroll', scroll); container.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      container.removeEventListener('wheel', wheel); container.removeEventListener('keydown', key);
      container.classList.remove('ib-scroll-morph');
      container.style.removeProperty('--ib-rail-shrink'); container.style.removeProperty('--ib-rail-progress');
    };
  }, [containerRef, version]);
}
