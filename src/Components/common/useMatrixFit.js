import { useEffect } from 'react';
import { fitMatrix } from '../../Utils/matrixFit';
import { matrixFitConfig } from '../../config';

const properties = ['--ib-fit-width', '--ib-cell-unit', '--ib-stage-width', '--ib-column-width', '--ib-fit-padding', '--ib-fit-extra-padding'];

// Measure the unscaled layout independently of Phase 2; otherwise reflow feeds
// back into the next measurement and the matrix can grow/oscillate on resize.
function measureBase(table, density, stageWidth, columnWidth, columnCount) {
  const host = document.createElement('div');
  host.className = 'ib-workspace';
  host.dataset.density = density;
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${stageWidth + columnCount * columnWidth}px;visibility:hidden;pointer-events:none`;
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
  section.append(clone); host.append(section); document.body.append(host);
  try {
    return { height: clone.getBoundingClientRect().height, rows: [...clone.rows].map(row => row.getBoundingClientRect().height) };
  } finally { host.remove(); }
}

export default function useMatrixFit(containerRef, columnCount, contentVersion, onOverflow, options = matrixFitConfig) {
  useEffect(() => {
    const container = containerRef.current, table = container?.querySelector('table');
    if (!table || !columnCount) return;
    const workspace = container.closest('.ib-workspace');
    let frame, base, baseKey, lastKey, disposed = false;
    const measure = () => {
      frame = undefined;
      if (disposed || !container.clientWidth || !table.getClientRects().length) return;
      const styles = getComputedStyle(container.closest('.ib-matrix-section'));
      const columnWidth = Number(styles.getPropertyValue('--ib-column-units')) || 104;
      const stageWidth = Number(styles.getPropertyValue('--ib-stage-units')) || 88;
      const density = workspace?.dataset.density || 'comfortable';
      const nextBaseKey = `${density}:${columnWidth}:${stageWidth}`;
      if (!base || baseKey !== nextBaseKey) { base = measureBase(table, density, stageWidth, columnWidth, columnCount); baseKey = nextBaseKey; }
      if (!(base.height > 0)) return;
      const heightBudget = options.maxHeightPx ?? window.innerHeight * options.viewportHeightRatio;
      // Small screens retain readable base text inside a contained scroll viewport.
      const availableWidth = Math.max(container.clientWidth, stageWidth + columnCount * columnWidth);
      const availableHeight = Math.max(base.height, heightBudget);
      const key = `${nextBaseKey}:${availableWidth}:${availableHeight}:${base.height}`;
      if (key !== lastKey) {
        const fit = fitMatrix({ ...options, containerWidth: availableWidth, containerHeight: availableHeight, columnCount, columnWidth, stageWidth, baseHeight: base.height });
        const values = [fit.width, fit.scale, fit.stageWidth, fit.columnWidth, fit.paddingX, fit.paddingAdded];
        properties.forEach((property, index) => table.style.setProperty(property, `${values[index]}px`));
        [...table.rows].forEach((row, index) => { row.style.height = `${base.rows[index] * fit.scale}px`; });
        table.dataset.fitPhase = fit.phase2 ? '2' : '1';
        lastKey = key;
      }
      container.style.maxHeight = `${heightBudget}px`;
      onOverflow?.(container.scrollWidth > container.clientWidth + 1);
    };
    const schedule = () => { if (!disposed && frame === undefined) frame = requestAnimationFrame(measure); };
    const invalidate = () => { base = undefined; lastKey = undefined; schedule(); };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    const mutation = new MutationObserver(invalidate);
    if (workspace) mutation.observe(workspace, { attributes: true, attributeFilter: ['data-density'] });
    const deviceQuery = window.matchMedia('(hover: none), (pointer: coarse)');
    deviceQuery.addEventListener('change', invalidate);
    document.fonts?.addEventListener('loadingdone', invalidate);
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(() => { if (!disposed) invalidate(); });
    schedule();
    return () => {
      disposed = true; if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule);
      deviceQuery.removeEventListener('change', invalidate);
      document.fonts?.removeEventListener('loadingdone', invalidate);
      properties.forEach(property => table.style.removeProperty(property));
      [...table.rows].forEach(row => { row.style.height = ''; });
      container.style.maxHeight = ''; delete table.dataset.fitPhase;
    };
  }, [containerRef, columnCount, contentVersion, onOverflow, options]);
}
