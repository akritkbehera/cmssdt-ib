// Keep configuration build state separate from the outcomes of later test stages.
export function configurationBuildState(ib, architecture) {
  const matches = (ib?.builds || []).filter(result => result.arch === architecture);
  if (matches.length !== 1) return { status: 'unknown', running: false };
  const result = matches[0];
  if (['queued', 'pending', 'not-started'].includes(result.passed)) {
    return { status: 'queued', running: false };
  }
  const running = result.done === false;
  if ([false, 'error', 'failed'].includes(result.passed)) return { status: 'failed', running };
  if (result.passed === 'warning') return { status: 'warnings', running };
  if (running) return { status: 'running', running: true };
  if ([true, 'passed'].includes(result.passed)) return { status: 'passed', running: false };
  return { status: 'unknown', running: false };
}

export function familyBuildState(ib, architectures) {
  const states = architectures.map(architecture => configurationBuildState(ib, architecture));
  const status = ['failed', 'warnings', 'running', 'unknown', 'queued', 'passed']
    .find(value => states.some(state => state.status === value)) || 'unknown';
  return { status, running: states.some(state => state.running) };
}

export function architectureParts(architecture = '') {
  const [platform = '', processor = '', ...compiler] = architecture.split('_');
  return [platform, processor, compiler.join('_')];
}

// Highlight differences from the visible matrix's unambiguous modal values.
// A tie has no default: neither candidate should be presented as the exception.
export function architectureDefaults(architectures) {
  const parts = architectures.map(architectureParts);
  return [0, 1, 2].map(index => {
    const counts = new Map();
    parts.forEach(values => {
      if (values[index]) counts.set(values[index], (counts.get(values[index]) || 0) + 1);
    });
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    return ranked.length && ranked[0][1] !== ranked[1]?.[1] ? ranked[0][0] : undefined;
  });
}

export function matchesResultFilter(status, filter) {
  if (filter === 'all') return true;
  if (filter === 'issues') return status === 'danger' || status === 'warning';
  return status === filter;
}

export function sectionState(items) {
  const statuses = items.map(item => item.labelColor === 'red' ? 'danger'
    : item.labelColor === 'orange' ? 'warning'
      : item.labelColor === 'green' ? 'success' : item.variant || 'secondary');
  const running = items.some(item => item.running || item.variant === 'info' || item.labelColor === 'info');
  const status = statuses.includes('danger') ? 'danger' : statuses.includes('warning') ? 'warning'
    : statuses.some(value => value === 'success') && statuses.every(value => ['success', 'info'].includes(value)) ? 'success' : statuses.includes('info') ? 'info' : 'secondary';
  return { status, running };
}

export function testGroupState(tests, failureKey) {
  return sectionState(Object.values(tests || {}).map(result => {
    const details = result.details || {};
    const variant = Number(details[failureKey]) > 0 || [false, 'error', 'failed'].includes(result.passed) ? 'danger'
      : Number(details.known_failed) > 0 || Number(details.num_warnings) > 0 || result.passed === 'warning' ? 'warning'
        : [true, 'passed'].includes(result.passed) || Number(details.num_passed) > 0 ? 'success' : 'secondary';
    return { variant, running: result.done === false };
  }));
}
