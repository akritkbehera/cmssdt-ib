/** A deterministic two-phase fit; horizontal slack never changes Phase 1's scale. */
export function fitMatrix({ containerWidth, containerHeight, columnCount, columnWidth, stageWidth, baseHeight, paddingX = 6, maxUniformScale = 1.25, horizontalThreshold = 0.05, maxGapMultiplier = 2 }) {
  if (![containerWidth, containerHeight, columnWidth, stageWidth, baseHeight, maxUniformScale].every(value => Number.isFinite(value) && value > 0) || !Number.isInteger(columnCount) || columnCount < 0) throw new RangeError('Matrix dimensions must be positive and finite');
  if (!Number.isFinite(horizontalThreshold) || horizontalThreshold < 0 || horizontalThreshold > 1 || !Number.isFinite(maxGapMultiplier) || maxGapMultiplier < 1 || !Number.isFinite(paddingX) || paddingX < 0 || 2 * paddingX > columnWidth) throw new RangeError('Invalid matrix fit options');
  const baseWidth = stageWidth + columnCount * columnWidth;
  const scale = Math.min(maxUniformScale, containerWidth / baseWidth, containerHeight / baseHeight);
  const phase1Width = baseWidth * scale;
  const height = baseHeight * scale;
  const leftover = Math.max(0, containerWidth - phase1Width);
  const phase2 = columnCount > 0 && leftover > 0.001 && leftover / containerWidth > horizontalThreshold;
  const basePadding = paddingX * scale;
  const paddingAdded = phase2 ? Math.min(leftover / (2 * columnCount), basePadding * (maxGapMultiplier - 1)) : 0;
  const gapGrowth = 2 * columnCount * paddingAdded;
  const cellGrowth = phase2 ? Math.max(0, leftover - gapGrowth) : 0;
  return {
    scale, height, phase1Width, leftover, phase2,
    width: phase2 ? containerWidth : phase1Width,
    stageWidth: stageWidth * scale,
    columnWidth: columnWidth * scale + (phase2 ? leftover / columnCount : 0),
    paddingX: basePadding + paddingAdded, paddingAdded,
    contentWidth: (columnWidth - 2 * paddingX) * scale + (columnCount ? cellGrowth / columnCount : 0),
    gapGrowth, cellGrowth
  };
}
