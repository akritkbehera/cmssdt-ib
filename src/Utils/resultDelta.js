export const stages = ['builds', 'utests', 'relvals', 'addons', 'dupDict'];
const outcome = value => [false, 'error', 'failed'].includes(value) ? 'fail' : [true, 'passed'].includes(value) ? 'pass' : value === 'warning' ? 'warning' : null;
const metricsFor = stage => stage === 'builds'
  ? ['compError', 'linkError', 'dictError', 'pythonError', 'dwnlError', 'miscError', 'compWarning']
  : ['num_failed', 'num_fails', 'num_errors', 'num_passed', 'num_warnings', 'known_failed'];
const count = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0;

/** Compare each named count independently; no aggregation across metrics/units. */
export function resultDelta(current, previous, stage) {
  if (!current || !previous || current.done === false || previous.done === false) return null;
  const now = outcome(current.passed), before = outcome(previous.passed);
  if (!now || !before) return null;
  const keys = metricsFor(stage).filter(key => Object.hasOwn(current.details || {}, key));
  const oldKeys = metricsFor(stage).filter(key => Object.hasOwn(previous.details || {}, key));
  if (JSON.stringify(keys) !== JSON.stringify(oldKeys)) return null;
  if (keys.some(key => !count(current.details[key]) || !count(previous.details[key]))) return null;
  const metrics = keys.map(key => {
    const currentCount = Number(current.details[key]), previousCount = Number(previous.details[key]);
    const delta = currentCount - previousCount;
    const warning = /Warning|warning|known_failed/.test(key);
    const favorable = key === 'num_passed' ? delta > 0 : delta < 0;
    return { key, delta, current: currentCount, previous: previousCount,
      tone: warning ? 'warning' : favorable ? 'success' : 'danger',
      label: `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` };
  }).filter(metric => metric.delta !== 0);
  const transition = now === 'fail' && before === 'pass' ? 'Newly failing'
    : now === 'pass' && before === 'fail' ? 'Fixed'
    : now === 'warning' && before !== 'warning' ? 'Now warning'
    : now === 'pass' && before === 'warning' ? 'Warning cleared' : null;
  const detail = `${stage}: previous ${before}, current ${now}. ` + (metrics.length
    ? metrics.map(metric => `${metric.key}: previous ${metric.previous}, current ${metric.current}, ${metric.label} (${metric.tone === 'warning' ? 'warning count change' : metric.tone === 'success' ? 'improved' : 'worsened'})`).join('; ')
    : now === 'fail' ? 'Still failing; counts unchanged or not supplied' : 'Status unchanged; no count change');
  return { label: transition, metrics, novel: transition === 'Newly failing', tone: transition === 'Fixed' || transition === 'Warning cleared' ? 'success' : now === 'warning' ? 'warning' : 'danger', detail };
}
