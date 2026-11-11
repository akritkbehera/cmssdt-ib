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

// Flavour options use the latest available run within the same release line.
export function historyFlavours(selected, records) {
  const anchor = ibIdentity(selected);
  const prefix = anchor?.series.match(/^(CMSSW_\d+_\d+_)/)?.[1];
  if (!prefix) return [];
  const latest = new Map();
  for (const ib of [selected, ...records]) {
    const id = ibIdentity(ib);
    if (!id || !id.series.startsWith(prefix)) continue;
    const previous = latest.get(id.series);
    if (!previous || id.time > previous.id.time ||
        (id.time === previous.id.time && id.sequence > previous.id.sequence)) latest.set(id.series, { ib, id });
  }
  return [...latest.values()].map(item => item.ib).sort((a, b) => a.release_queue.localeCompare(b.release_queue));
}

/** One flavour retains its full history. Multiple flavours retain their latest
 * runs plus every exact timestamp shared by all selected flavours. */
export function selectHistoryBuilds(selected, records, showAll = false) {
  const available = [...records];
  const candidates = selected.flatMap(ib => flavourHistory(ib, available));
  if (selected.length < 2) return candidates;
  const latest = new Set(selected);
  const timestamps = new Map();
  for (const ib of candidates) {
    const id = ibIdentity(ib);
    const stamp = JSON.stringify([id.time, id.sequence]);
    if (!timestamps.has(stamp)) timestamps.set(stamp, new Set());
    timestamps.get(stamp).add(id.series);
  }
  const unique = new Map();
  for (const ib of candidates) {
    const id = ibIdentity(ib);
    const stamp = JSON.stringify([id.time, id.sequence]);
    if (showAll || latest.has(ib) || timestamps.get(stamp).size === selected.length) {
      unique.set(JSON.stringify([id.series, id.variant, id.name]), { ib, id });
    }
  }
  return [...unique.values()].sort((a, b) => b.id.time - a.id.time ||
    b.id.sequence - a.id.sequence || a.id.series.localeCompare(b.id.series)).map(item => item.ib);
}


/** Presentation groups never imply a timestamp match merely because days agree. */
export function historyCards(builds, latestNames = []) {
  const valid = builds.filter(ib => ibIdentity(ib));
  const queues = new Set(valid.map(ib => ib.release_queue));
  const stamps = new Map();
  for (const ib of valid) {
    const id = ibIdentity(ib), key = JSON.stringify([id.time, id.sequence]);
    if (!stamps.has(key)) stamps.set(key, new Set());
    stamps.get(key).add(id.series);
  }
  const matched = queues.size > 1 && [...stamps.values()].some(set => set.size === queues.size);
  if (queues.size > 1 && !matched) {
    const latest = valid.filter(ib => latestNames.includes(ib.release_name));
    return [{ key: 'latest', title: 'Latest comparison', differentTimes: true, builds: latest.length ? latest : valid }];
  }
  const days = new Map();
  for (const ib of [...valid].sort((a,b) => ibIdentity(b).time - ibIdentity(a).time)) {
    const day = new Date(ibIdentity(ib).time).toISOString().slice(0,10);
    if (!days.has(day)) days.set(day, { key: day, title: day, builds: [] });
    days.get(day).builds.push(ib);
  }
  return [...days.values()];
}
