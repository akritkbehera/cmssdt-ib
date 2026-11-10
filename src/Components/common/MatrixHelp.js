import React from 'react';

export default function MatrixHelp({compact = false}) {
  return (
      <details className={`ib-matrix-help ${compact ? 'ib-compact-guide' : ''}`} onClick={event => event.stopPropagation()}>
        <summary>{compact ? 'Results guide' : 'How to read results and comparisons'}</summary>
        <div className="ib-matrix-help-content">
      <p className="ib-matrix-legend">✓ passed · ✕ failed · ! warning · – unavailable. Build numbers count errors/warnings; Unit, RelVal and AddOn numbers count test results. Q/A is the reported duplicate-check outcome; ✕ is a failure, not “not run”. Linked cells open details. Counts remain separate from their state marks; a large count does not by itself mean a new regression.</p>
        <p className="ib-matrix-footnote">Stage counts describe reported outcomes for selected configurations, including partial results. A rotating rim and radar sweep that lights the dimmed state mark mean running; final comparisons are withheld until completion. Only the latest IB in an exact queue/variant sequence has comparisons. Missing or ambiguous configurations never count as zero. Newly failing means a pass-to-fail transition, not a unique failure identity. Each metric delta compares the same named count; +passes is favorable, +failures is adverse. Unchanged counts have no delta. Baselines are drawn from the complete response available to this page, before filters.</p>
        </div>
      </details>
  );
}
