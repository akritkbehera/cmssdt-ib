import test from 'node:test';
import assert from 'node:assert/strict';
import { fitMatrix } from '../src/Utils/matrixFit.js';
const base = { containerWidth: 1000, containerHeight: 250, columnCount: 4, columnWidth: 100, stageWidth: 80, baseHeight: 200, paddingX: 6, maxUniformScale: 2, horizontalThreshold: 0.05, maxGapMultiplier: 2 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('Phase 1 respects the limiting height and Phase 2 never changes that scale or height', () => {
  const fit = fitMatrix(base);
  close(fit.scale, 1.25); close(fit.height, 250); close(fit.phase1Width, 600);
  assert.equal(fit.phase2, true); close(fit.width, 1000);
  close(fit.stageWidth + 4 * fit.columnWidth, fit.width);
});
test('small leftover skips Phase 2 and retains the original aspect ratio', () => {
  const fit = fitMatrix({ ...base, containerWidth: 630 });
  assert.equal(fit.phase2, false); close(fit.width, 600); close(fit.width / fit.height, 480 / 200);
  close(fit.paddingAdded, 0); close(fit.cellGrowth, 0);
});
test('threshold boundary is strict and configurable', () => {
  assert.equal(fitMatrix({ ...base, containerWidth: 640, horizontalThreshold: 0.0625 }).phase2, false);
  assert.equal(fitMatrix({ ...base, containerWidth: 640, horizontalThreshold: 0.06 }).phase2, true);
  assert.equal(fitMatrix({ ...base, horizontalThreshold: 1 }).phase2, false);
});
test('padding grows first without stretching cell content', () => {
  const fit = fitMatrix({ ...base, containerWidth: 620, horizontalThreshold: 0 });
  close(fit.gapGrowth, 20); close(fit.paddingX, 10); close(fit.cellGrowth, 0);
  close(fit.contentWidth, (100 - 12) * 1.25);
});
test('only width left after the padding cap stretches content', () => {
  const fit = fitMatrix(base);
  close(fit.paddingX, 15); close(fit.gapGrowth, 60); close(fit.cellGrowth, 340);
  close(fit.paddingX / (6 * fit.scale), 2);
  const noGapGrowth = fitMatrix({ ...base, maxGapMultiplier: 1 });
  close(noGapGrowth.gapGrowth, 0); close(noGapGrowth.cellGrowth, 400);
});
test('width-limited fit does not run Phase 2 or overflow', () => {
  const fit = fitMatrix({ ...base, containerWidth: 240, containerHeight: 500 });
  close(fit.scale, 0.5); close(fit.width, 240); close(fit.height, 100);
  assert.equal(fit.phase2, false);
});
test('fit is deterministic across grow/shrink cycles and respects both container dimensions', () => {
  for (const width of [200, 700, 2048, 350, 1000]) {
    const fit = fitMatrix({ ...base, containerWidth: width });
    assert.ok(fit.width <= width + 1e-8); assert.ok(fit.height <= 250);
    close(fit.stageWidth + 4 * fit.columnWidth, fit.width);
  }
  assert.deepEqual(fitMatrix(base), fitMatrix(base));
});
test('empty matrices and invalid settings cannot produce NaN or invalid geometry', () => {
  const fit = fitMatrix({ ...base, columnCount: 0 });
  assert.equal(fit.phase2, false); assert.ok(Number.isFinite(fit.contentWidth));
  for (const patch of [{ containerWidth: 0 }, { baseHeight: NaN }, { horizontalThreshold: -1 }, { horizontalThreshold: 2 }, { maxGapMultiplier: 0.5 }, { paddingX: -1 }, { columnCount: 1.5 }]) assert.throws(() => fitMatrix({ ...base, ...patch }), RangeError);
});
