import React from 'react';
import StatusDot from './StatusDot';

export default function BuildSummary({ counts, filter = 'all', onFilter }) {
  const pending = counts.info + counts.secondary;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return (
    <div className="ib-build-summary" aria-label="Reported stage outcomes for selected architectures">
      <strong>Stage results</strong>
      <div className="ib-summary-counts">
        {[['danger', 'Failures'], ['warning', 'Warnings'], ['success', 'Passed']].map(([status, label]) => (
          <button type="button" key={status} className={`ib-summary-badge ib-status-${status}`}
            aria-pressed={filter === status} onClick={() => onFilter?.(filter === status ? 'all' : status)}>
            <StatusDot status={status} size={16} /><span className="ib-summary-number">{counts[status]}</span>{label}
          </button>
        ))}
        {pending > 0 && <span className="ib-summary-badge ib-status-secondary"><StatusDot size={16} />{pending} pending / unknown</span>}
        {!total && <span className="ib-summary-empty">No reported results</span>}
      </div>
    </div>
  );
}
