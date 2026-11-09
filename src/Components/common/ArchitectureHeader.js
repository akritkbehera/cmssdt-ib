import React from 'react';

export default function ArchitectureHeader({ architecture, icon, status = 'unknown' }) {
  const [platform, ...toolchain] = architecture.split('_');
  const labels = { passed: 'Passed', failed: 'Failed', warnings: 'Warnings', running: 'Running', unknown: 'Unknown' };
  const marks = { passed: '✓', failed: '×', warnings: '!', running: '•', unknown: '–' };
  return (
    <div className="ib-architecture-header" aria-label={architecture}>
      <span className="ib-architecture-platform">{icon && <span className="ib-build-kind">{icon}</span>}{platform}</span>
      <span className="ib-architecture-toolchain">{toolchain.map((value, index) => <span className="ib-architecture-value" key={`${value}-${index}`}>{value}</span>)}</span>
      <span className="ib-config-status" aria-label={`Build status: ${labels[status]}`}><span className="ib-config-status-mark" aria-hidden="true">{marks[status]}</span>{labels[status]}</span>
    </div>
  );
}
