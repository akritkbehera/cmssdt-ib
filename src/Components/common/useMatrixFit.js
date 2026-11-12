import { useEffect, useRef } from 'react';
import { fitMatrix } from '../../Utils/matrixFit';
import { matrixFitConfig } from '../../config';

const properties = ['--ib-fit-width', '--ib-cell-unit', '--ib-stage-width', '--ib-column-width', '--ib-fit-padding', '--ib-fit-extra-padding'];

// Measure the unscaled layout independently of Phase 2; otherwise reflow feeds
// back into the next measurement and the matrix can grow/oscillate on resize.
function measureBase(table, density, stageWidth, columnWidth, columnCount, twoCards) {
  const host = document.createElement('div');
  host.className = table.closest('.ib-history-body') ? 'ib-workspace ib-history-body' : 'ib-workspace';
  host.dataset.density = density;
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${stageWidth + columnCount * columnWidth}px;visibility:hidden;pointer-events:none`;
  host.style.setProperty('--ib-card-list-top', getComputedStyle(table).getPropertyValue('--ib-card-list-top'));
  const section = document.createElement('div');
  section.className = 'ib-matrix-section ib-fit-measure';
  const clone = table.cloneNode(true);
  clone.querySelectorAll('tr').forEach(row => { row.style.height = ''; });
  clone.style.setProperty('--ib-cell-unit', '1px');
  clone.style.setProperty('--ib-fit-width', `${stageWidth + columnCount * columnWidth}px`);
  clone.style.setProperty('--ib-stage-width', `${stageWidth}px`);
  clone.style.setProperty('--ib-column-width', `${columnWidth}px`);
  clone.style.setProperty('--ib-fit-padding', '6px');
  clone.style.setProperty('--ib-fit-extra-padding', '0px');
  const card = document.createElement('div');
  card.className = 'ib-release-panel';
  card.dataset.prVisible = twoCards ? 'false' : 'true';
  section.append(clone); card.append(section); host.append(card); document.body.append(host);
  try {
    return { height: clone.getBoundingClientRect().height, rows: [...clone.rows].map(row => row.getBoundingClientRect().height) };
  } finally { host.remove(); }
}

export default function useMatrixFit(containerRef, columnCount, contentVersion, onOverflow, options = matrixFitConfig) {
  const measurements = useRef({version:null, bases:new Map()});
  useEffect(() => {
    const container = containerRef.current, table = container?.querySelector('table');
    if (!table || !columnCount) return;
    const workspace = container.closest('.ib-workspace');
    const card = container.closest('.ib-release-panel');
    let frame, base, baseKey, lastKey, disposed = false, nearby = true;
    const cache=measurements.current;
    if(cache.version!==contentVersion){cache.version=contentVersion;cache.bases.clear();}
    const rect=container.getBoundingClientRect();
    nearby=rect.top<window.innerHeight+700 && rect.bottom>-700 && rect.left<window.innerWidth+400 && rect.right>-400;
    const measure = () => {
      frame = undefined;
      if (disposed || !nearby || !container.clientWidth || !table.getClientRects().length) return;
      const styles = getComputedStyle(container.closest('.ib-matrix-section'));
      const columnWidth = Number(styles.getPropertyValue('--ib-column-units')) || 104;
      const stageWidth = Number(styles.getPropertyValue('--ib-stage-units')) || 88;
      const density = workspace?.dataset.density || 'comfortable';
      const twoCards = density === 'compact' && card?.dataset.prVisible === 'false' && window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches;
      const nextBaseKey = `${density}:${columnWidth}:${stageWidth}:${twoCards}:${twoCards ? window.innerHeight + ':' + getComputedStyle(workspace).getPropertyValue('--ib-card-list-top') : ''}`;
      if (!base || baseKey !== nextBaseKey) {
        base=cache.bases.get(nextBaseKey);
        if(!base){
          base=measureBase(table,density,stageWidth,columnWidth,columnCount,twoCards);
          if(cache.bases.size>=4)cache.bases.delete(cache.bases.keys().next().value);
          cache.bases.set(nextBaseKey,base);
        }
        baseKey=nextBaseKey;
      }
      if (!(base.height > 0)) return;
      const heightBudget = options.maxHeightPx ?? window.innerHeight * options.viewportHeightRatio;
      // Small screens retain readable base text inside a contained scroll viewport.
      const availableWidth = Math.max(container.clientWidth, stageWidth + columnCount * columnWidth);
      const availableHeight = Math.max(base.height, heightBudget);
      const key = `${nextBaseKey}:${availableWidth}:${availableHeight}:${base.height}`;
      if (key !== lastKey) {
        const fit = fitMatrix({ ...options, ...(twoCards ? { maxUniformScale: 1, paddingX: 4 } : {}), containerWidth: availableWidth, containerHeight: availableHeight, columnCount, columnWidth, stageWidth, baseHeight: base.height });
        const values = [fit.width, fit.scale, fit.stageWidth, fit.columnWidth, fit.paddingX, fit.paddingAdded];
        properties.forEach((property, index) => table.style.setProperty(property, `${values[index]}px`));
        [...table.rows].forEach((row, index) => { row.style.height = `${base.rows[index] * fit.scale}px`; });
        table.dataset.fitPhase = fit.phase2 ? '2' : '1';
        lastKey = key;
      }
      // The compact desktop layout exposes every row, without a vertical
      // scrolling viewport. Horizontal expansion still follows Phase 2.
      container.style.maxHeight = twoCards ? 'none' : `${heightBudget}px`;
      onOverflow?.(container.scrollWidth > container.clientWidth + 1);
    };
    const schedule = () => { if (!disposed && frame === undefined) frame = requestAnimationFrame(measure); };
    const invalidate = () => { base = undefined; lastKey = undefined; schedule(); };
    const invalidateFonts = () => { cache.bases.clear(); invalidate(); };
    const visibility=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
      nearby=entries.some(entry=>entry.isIntersecting);
      if(nearby)schedule();
    },{rootMargin:'700px 400px'});
    visibility?.observe(container);
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    const mutation = new MutationObserver(invalidate);
    if (workspace) mutation.observe(workspace, { attributes: true, attributeFilter: ['data-density', 'style'] });
    if (card) mutation.observe(card, { attributes: true, attributeFilter: ['data-pr-visible'] });
    const deviceQuery = window.matchMedia('(hover: none), (pointer: coarse)');
    deviceQuery.addEventListener('change', invalidate);
    document.fonts?.addEventListener('loadingdone', invalidateFonts);
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(() => { if (!disposed) invalidate(); });
    schedule();
    return () => {
      disposed = true; if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect(); mutation.disconnect(); visibility?.disconnect(); window.removeEventListener('resize', schedule);
      deviceQuery.removeEventListener('change', invalidate);
      document.fonts?.removeEventListener('loadingdone', invalidateFonts);
      properties.forEach(property => table.style.removeProperty(property));
      [...table.rows].forEach(row => { row.style.height = ''; });
      container.style.maxHeight = ''; delete table.dataset.fitPhase;
    };
  }, [containerRef, columnCount, contentVersion, onOverflow, options]);
}
