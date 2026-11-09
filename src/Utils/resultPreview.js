/** Parse identities, never infer fixes from aggregate count differences. */
const validCount = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0;
export function resultSnapshot(stage, data) {
  if (!Array.isArray(data)) return null;
  const entries = [], seen = new Set();
  for (const item of data) {
    const key = stage === 'relvals' ? item.id : item.name;
    if (key === undefined || key === null || seen.has(String(key))) return null;
    seen.add(String(key));
    let state, errors = 0;
    if (stage === 'relvals') {
      if (!Array.isArray(item.steps)) return null;
      const states = item.steps.map(step => step.status);
      if (states.some(value => ['STARTED', 'RUNNING', 'PENDING'].includes(value))) state = 'pending';
      else if (states.some(value => !['PASSED', 'NOTRUN', '', undefined].includes(value))) state = item.known_error ? 'warning' : 'failed';
      else state = states.includes('PASSED') ? 'passed' : 'pending';
      errors = state === 'failed' ? 1 : 0;
    } else if (stage === 'utests') {
      if (!validCount(item.errors)) return null;
      errors = Number(item.errors);
      state = errors > 0 ? 'failed' : 'passed';
    } else return null;
    entries.push({ key: String(key), label: stage === 'relvals' ? `${key} ${item.name || ''}`.trim() : String(key), state, errors });
  }
  return entries;
}

export function snapshotMatches(stage, entries, result) {
  if (!entries || !result || result.done === false || result.file === 'not-ready') return false;
  const details = result.details || {};
  const known = stage === 'relvals'
    ? { num_failed: entries.filter(item => item.state === 'failed').length, known_failed: entries.filter(item => item.state === 'warning').length, num_passed: entries.filter(item => item.state === 'passed').length }
    : { num_fails: entries.reduce((sum, item) => sum + item.errors, 0) };
  return Object.entries(known).every(([key, value]) => !Object.hasOwn(details, key) || validCount(details[key]) && Number(details[key]) === value);
}

export function previewGroups(current, previous = []) {
  const before = new Map(previous.map(item => [item.key, item]));
  const groups = { newFailures: [], fixed: [], stillFailing: [], failing: [], warnings: [], passing: [] };
  for (const item of current) {
    const old = before.get(item.key);
    if (item.state === 'failed') groups[old?.state === 'passed' ? 'newFailures' : old?.state === 'failed' ? 'stillFailing' : 'failing'].push(item);
    else if (item.state === 'warning') groups.warnings.push(item);
    else if (item.state === 'passed') groups[['failed', 'warning'].includes(old?.state) ? 'fixed' : 'passing'].push(item);
  }
  return groups;
}
