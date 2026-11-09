import { resultDelta } from './resultDelta.js';

const stable = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(stable(item)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))]))
  : value ?? null);

/** Backend queue is the canonical series. Never merge queues by display label.
 * The anchored name fallback only supplies a timestamp where metadata is absent. */
export function ibIdentity(ib) {
  if (!ib || ib.isIB !== true || ib.next_ib === true || typeof ib.release_queue !== 'string') return null;
  const name = typeof ib.release_name === 'string' ? ib.release_name : '';
  const tag = /^(.*)_(\d{4}-\d{2}-\d{2}-\d{4})$/.exec(name);
  // Refuse ambiguous names/queue combinations, including sanitizer mismatches.
  if (!tag || tag[1] !== ib.release_queue) return null;
  const raw = ib.ib_date ?? tag[2];
  const match = typeof raw === 'string' && /^(\d{4})-(\d{2})-(\d{2})[-T](\d{2}):?(\d{2})(?::00)?(?:-(\d{4}))?Z?$/.exec(raw);
  if (!match) return null;
  const [, y, m, d, h, min, sequence = 0] = match.map((value, index) => index && value !== undefined ? Number(value) : value);
  const time = Date.UTC(y, m - 1, d, h, min);
  const checked = new Date(time);
  if (checked.getUTCFullYear() !== y || checked.getUTCMonth() !== m - 1 || checked.getUTCDate() !== d || h > 23 || min > 59) return null;
  return { series: ib.release_queue, variant: ib.variant ?? ib.build_variant ?? ib.release_queue, time, sequence, name };
}

/** Select from all returned comparisons, before flavor/architecture filtering.
 * Empty earlier IBs remain eligible: missing data never shifts the baseline. */
export function buildComparisonIndex(records) {
  const sequences = new Map();
  const contexts = new Map();
  for (const ib of records) {
    const identity = ibIdentity(ib);
    if (!identity) { contexts.set(ib, { latest: false, reason: 'Comparison identity or timestamp unavailable' }); continue; }
    const key = stable([identity.series, identity.variant]);
    if (!sequences.has(key)) sequences.set(key, []);
    sequences.get(key).push({ ib, ...identity });
  }
  for (const sequence of sequences.values()) {
    sequence.sort((a, b) => b.time - a.time || b.sequence - a.sequence || a.name.localeCompare(b.name));
    const topTime = sequence[0].time, topSequence = sequence[0].sequence;
    const top = sequence.filter(item => item.time === topTime && item.sequence === topSequence);
    const predecessor = sequence.find(item => item.time < topTime || item.time === topTime && item.sequence < topSequence);
    const duplicateBaseline = predecessor && sequence.filter(item => item.time === predecessor.time && item.sequence === predecessor.sequence).length > 1;
    for (const item of sequence) {
      const latest = item.time === topTime && item.sequence === topSequence;
      const ambiguous = latest && (top.length !== 1 || duplicateBaseline);
      contexts.set(item.ib, {
        latest, previous: latest && !ambiguous ? predecessor?.ib : undefined,
        reason: ambiguous ? 'Ambiguous build ordering: comparison suppressed' : latest && !predecessor ? 'No previous comparable IB' : '',
        variant: item.variant
      });
    }
  }
  return contexts;
}

/** Preserve every backend result field except known outcomes and log locations.
 * Extra identity dimensions therefore suppress mismatches conservatively. */
export function cellKey(ib, result, stage) {
  const { passed, done, details, file, ...identity } = result;
  const parentIdentity = {};
  for (const key of ['flavor', 'configuration', 'configuration_id', 'patchSet', 'patch_set', 'toolchain']) {
    if (Object.hasOwn(ib, key)) parentIdentity[key] = ib[key];
  }
  return stable([ib.release_queue, ib.variant ?? ib.build_variant ?? ib.release_queue, parentIdentity, stage, identity]);
}

export function compareCell(ib, context, stage, arch) {
  if (!context?.latest) return null;
  const unavailable = () => null;
  if (!context.previous) return unavailable(context.reason || 'No previous comparable IB');
  const current = (ib[stage] || []).filter(result => result.arch === arch);
  if (current.length !== 1) return unavailable('Current cell is missing or ambiguous');
  const matches = (context.previous[stage] || []).filter(result => cellKey(ib, current[0], stage) === cellKey(context.previous, result, stage));
  if (matches.length !== 1) return unavailable(matches.length ? 'Duplicate baseline keys: comparison suppressed' : 'No exact matching baseline configuration/stage');
  const delta = resultDelta(current[0], matches[0], stage);
  return delta && (delta.label || delta.metrics?.length) ? { ...delta, detail: `${delta.detail}. Previous IB: ${context.previous.release_name}` }
    : null;
}
