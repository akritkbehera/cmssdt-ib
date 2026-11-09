import React from 'react';

export default function BuildSummary({ counts }) {
  const pending = counts.info + counts.secondary;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const label = counts.danger ? 'Stage failures' : counts.warning ? 'Stage warnings' : pending ? 'Results pending' : total ? 'All reported stages passed' : 'No reported results';
  return (
    <div className="ib-build-summary" aria-label="Reported stage outcomes for selected architectures">
      <strong className={counts.danger ? 'ib-summary-failed' : ''}>{label}</strong>
      <div className="ib-summary-counts">
        <span className="ib-summary-badge ib-status-danger">✕ {counts.danger} stage {counts.danger === 1 ? 'failure' : 'failures'}</span>
        <span className="ib-summary-badge ib-status-warning">⚠ {counts.warning} stage {counts.warning === 1 ? 'warning' : 'warnings'}</span>
        <span className="ib-summary-badge ib-status-success">✓ {counts.success} stage {counts.success === 1 ? 'pass' : 'passes'}</span>
        {pending > 0 && <span className="ib-summary-badge ib-status-secondary">{pending} pending / unknown</span>}
      </div>
    </div>
  );
}
