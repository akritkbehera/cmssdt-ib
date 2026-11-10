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

// Keep switching within the same CMSSW release line and original time horizon.
export function historyFlavours(selected, records) {
  const anchor = ibIdentity(selected);
  const prefix = anchor?.series.match(/^(CMSSW_\d+_\d+_)/)?.[1];
  if (!prefix) return [];
  const latest = new Map();
  for (const ib of [selected, ...records]) {
    const id = ibIdentity(ib);
    if (!id || !id.series.startsWith(prefix) || id.time > anchor.time ||
        (id.time === anchor.time && id.sequence > anchor.sequence)) continue;
    const previous = latest.get(id.series);
    if (!previous || id.time > previous.id.time ||
        (id.time === previous.id.time && id.sequence > previous.id.sequence)) latest.set(id.series, { ib, id });
  }
  return [...latest.values()].map(item => item.ib).sort((a, b) => a.release_queue.localeCompare(b.release_queue));
}
