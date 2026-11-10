import { ibIdentity } from './ibComparison.js';

export function flavourHistory(selected, records) {
  const anchor = ibIdentity(selected);
  if (!anchor) return [];
  const entries = new Map();
  for (const ib of [selected, ...records]) {
    const id = ibIdentity(ib);
    if (!id || id.series !== anchor.series || id.variant !== anchor.variant ||
        id.time > anchor.time || (id.time === anchor.time && id.sequence > anchor.sequence)) continue;
    const key = JSON.stringify([id.name, id.time, id.sequence]);
    if (!entries.has(key)) entries.set(key, { ib, id });
  }
  return [...entries.values()].sort((a, b) => b.id.time - a.id.time || b.id.sequence - a.id.sequence)
    .map(entry => entry.ib);
}
