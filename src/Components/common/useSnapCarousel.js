import { useEffect, useRef } from 'react';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function useSnapCarousel(rootRef, index, count, onChange, enabled, version) {
  const controller = useRef(null);
  const latest = useRef({ index, onChange });
  latest.current = { index, onChange };
  useEffect(() => {
    const root = rootRef.current;
    const viewport = root?.querySelector('.ib-phone-carousel-viewport');
    if (!enabled || !viewport || !count) return;
    let step = viewport.clientWidth, active = latest.current.index, offset = -active * step;
    let frame, gesture, wheel, wheelTimer, wheelUnlock, clickTimer, blockedWheel = false;
    const sign = getComputedStyle(root).direction === 'rtl' ? -1 : 1;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const paint = () => {
      root.style.setProperty('--ib-swipe-progress', String(step ? offset / step * sign : 0));
      const overshoot = offset > 0 ? offset : Math.max(0, -(count - 1) * step - offset);
      root.style.setProperty('--ib-swipe-edge-stretch', String(step ? Math.min(.18, overshoot / step) : 0));
      root.style.setProperty('--ib-swipe-edge-origin', offset > 0 ? 'left center' : 'right center');
      root.style.setProperty('--ib-swipe-activity', String(step ? Math.min(1, Math.abs(offset / step + active)) : 0));
    };
    const cancel = () => { cancelAnimationFrame(frame); frame = undefined; };
    const settle = destination => {
      cancel(); clearTimeout(wheelTimer); wheel = null;
      active = clamp(destination, 0, count - 1);
      latest.current.onChange(active);
      const start = offset, end = -active * step, began = performance.now();
      if (reduced.matches || Math.abs(end - start) < .1) { offset = end; paint(); return; }
      const duration = clamp(300 * Math.abs(end - start) / Math.max(step, 1), 260, 420);
      const tick = now => {
        const progress = Math.min(1, (now - began) / duration);
        offset = start + (end - start) * (1 - Math.pow(1 - progress, 3));
        paint();
        if (progress < 1) frame = requestAnimationFrame(tick);
        else frame = undefined;
      };
      frame = requestAnimationFrame(tick);
    };
    controller.current = { settle, get active() { return active; } };
    const surface = target => target.closest?.('.ib-phone-carousel-viewport, .ib-phone-config-choice');
    const interactive = target => target.closest?.('button, a, input, select, textarea, summary, [role="button"]');
    const resisted = value => value > 0 ? value * .3
      : value < -(count - 1) * step ? -(count - 1) * step + (value + (count - 1) * step) * .3 : value;
    const down = event => {
      suppressClick = false; clearTimeout(clickTimer);
      if (!event.isPrimary || event.button !== 0 || !surface(event.target) || interactive(event.target) || wheel) return;
      cancel(); suppressClick = false;
      gesture = { id:event.pointerId, x:event.clientX, y:event.clientY, offset, index:active,
        width:(event.target.closest('.ib-phone-choice-viewport') || viewport).clientWidth,
        locked:false, samples:[{x:event.clientX, time:performance.now()}], target:event.target };
    };
    const move = event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (!gesture.locked) {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx) * 1.2) { settle(gesture.index); gesture = null; return; }
        if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
        gesture.locked = true;
        root.setPointerCapture(event.pointerId);
      }
      const now = performance.now();
      gesture.samples.push({x:event.clientX, time:now});
      gesture.samples = gesture.samples.filter(sample => now - sample.time <= 120);
      // A single gesture can reveal its immediate neighbours only.
      offset = resisted(clamp(gesture.offset + dx * sign * step / Math.max(1, gesture.width), -(gesture.index + 1) * step, -(gesture.index - 1) * step));
      paint();
    };
    let suppressClick = false;
    const up = (event, cancelled = false) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const current = gesture;
      gesture = null;
      const distance = (event.clientX - current.x) * sign;
      const now = performance.now();
      const samples = current.samples.filter(sample => now - sample.time <= 120);
      const sample = samples[0];
      const velocity = sample && now > sample.time ? (event.clientX - sample.x) * sign / (now - sample.time) : 0;
      const commit = current.locked && !cancelled && (Math.abs(distance) >= current.width * .22 || Math.abs(distance) > 12 && Math.abs(velocity) >= .45);
      if (current.locked) {
        suppressClick = true;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { suppressClick = false; }, 50);
        if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
      }
      settle(cancelled ? clamp(Math.round(-offset / step), current.index - 1, current.index + 1)
        : commit ? current.index + (distance < 0 ? 1 : -1) : current.index);
    };
    const cancelPointer = event => up(event, true);
    // Touch starts with implicit capture on the touched child. Moving capture
    // to the carousel emits lostpointercapture on that child; dragging continues.
    const lostCapture = event => {
      if (event.target === root && !root.hasPointerCapture(event.pointerId)) up(event, true);
    };
    const click = event => {
      if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
    };
    const finishWheel = () => {
      const current = wheel;
      if (!current) return;
      wheel = null;
      settle(Math.abs(current.distance) >= step * .22 || Math.abs(current.distance) > 12 && Math.abs(current.velocity) >= .45
        ? current.index + (current.distance < 0 ? 1 : -1) : current.index);
      blockedWheel = true;
      wheelUnlock = setTimeout(() => { blockedWheel = false; }, 180);
    };
    const onWheel = event => {
      if (!surface(event.target) || interactive(event.target) || gesture || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (blockedWheel) {
        clearTimeout(wheelUnlock);
        wheelUnlock = setTimeout(() => { blockedWheel = false; }, 180);
        return;
      }
      const now = performance.now(), units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? step : 1;
      const dx = -event.deltaX * units * sign;
      if (!wheel) { cancel(); wheel = {index:active, offset, distance:0, time:now - 16, velocity:0}; }
      wheel.distance += dx;
      wheel.velocity = dx / Math.max(1, now - wheel.time);
      wheel.time = now;
      offset = resisted(clamp(wheel.offset + wheel.distance, -(wheel.index + 1) * step, -(wheel.index - 1) * step));
      paint();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(finishWheel, 120);
    };
    const key = event => {
      if (!surface(event.target) || interactive(event.target) || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      settle(active + (event.key === 'ArrowRight' ? sign : -sign));
    };
    const resize = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      if (!width || width === step) return;
      cancel(); gesture = null; wheel = null;
      clearTimeout(wheelTimer);
      step = width; offset = -active * step; paint();
    });
    resize.observe(viewport);
    paint();
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', cancelPointer);
    root.addEventListener('lostpointercapture', lostCapture);
    root.addEventListener('click', click, true);
    root.addEventListener('wheel', onWheel, {passive:false});
    root.addEventListener('keydown', key);
    return () => {
      cancel(); clearTimeout(wheelTimer); clearTimeout(wheelUnlock); clearTimeout(clickTimer); resize.disconnect();
      root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', cancelPointer);
      root.removeEventListener('lostpointercapture', lostCapture); root.removeEventListener('click', click, true);
      root.removeEventListener('wheel', onWheel); root.removeEventListener('keydown', key);
      controller.current = null; root.style.removeProperty('--ib-swipe-progress'); root.style.removeProperty('--ib-swipe-activity'); root.style.removeProperty('--ib-swipe-edge-stretch'); root.style.removeProperty('--ib-swipe-edge-origin');
    };
  }, [rootRef, enabled, count, version]);
  useEffect(() => {
    if (controller.current && controller.current.active !== index) controller.current.settle(index);
  }, [index]);
  return destination => controller.current?.settle(destination);
}
