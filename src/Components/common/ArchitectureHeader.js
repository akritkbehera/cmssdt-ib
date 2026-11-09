import React from 'react';
import StatusDot from './StatusDot';
import { architectureParts } from '../../Utils/buildStatus';

export default function ArchitectureHeader({ architecture, icon, status = 'unknown', running = false, defaults = [] }) {
  const [platform, processor, compiler] = architectureParts(architecture);
  const labels = { passed: 'Passed', failed: 'Failed', warnings: 'Warnings', running: 'Running', queued: 'Queued', unknown: 'Unknown' };
  const tones = { passed: 'success', failed: 'danger', warnings: 'warning', running: 'info', queued: 'secondary', unknown: 'secondary' };
  const alternate = (value, index) => defaults[index] && value !== defaults[index] ? 'is-alternate' : '';
  const description = `${labels[status]}${running && status !== 'running' ? ' so far; build still running' : ''}`;
  return (
    <div className="ib-architecture-header" aria-label={architecture}>
      <span className={`ib-architecture-platform ${alternate(platform, 0)}`}>
        {icon && <span className="ib-build-kind" aria-hidden="true">{icon}</span>}{platform}
      </span>
      <span className="ib-architecture-toolchain">
        {[processor, compiler].map((value, index) => value && (
          <span className={`ib-architecture-value ${alternate(value, index + 1)}`} key={`${value}-${index}`}>{value}</span>
        ))}
      </span>
      <span className="ib-config-status" aria-label={`Build status: ${description}`} title={description}>
        <StatusDot status={tones[status]} running={running} size={20} solid={['passed', 'failed', 'warnings'].includes(status) && !running} />
        {labels[status]}
      </span>
    </div>
  );
}
