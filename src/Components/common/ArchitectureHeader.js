import React from 'react';
import { architectureParts } from '../../Utils/buildStatus';

export default function ArchitectureHeader({ architecture, icon, status = 'unknown', running = false, colors = {}, productionColor }) {
  const values = architectureParts(architecture).filter(Boolean);
  const labels = { passed: 'Passed', failed: 'Failed', warnings: 'Warnings', running: 'Running', queued: 'Queued', unknown: 'Unknown' };
  const isDefault = value => Boolean(productionColor && colors[value] === productionColor);
  const defaultConfiguration = values.length === 3 && values.every(isDefault);
  const description = `${architecture} · ${defaultConfiguration ? 'Default configuration · ' : ''}Build status: ${labels[status]}${running && status !== 'running' ? ' so far; build still running' : ''}`;
  return (
    <div className="ib-architecture-header ib-config-label" aria-label={description} title={description}>
      {icon && <span className="ib-build-kind" aria-hidden="true">{icon}</span>}
      {values.map((value, index) => <React.Fragment key={`${value}-${index}`}>
        {index > 0 && <span className="ib-config-separator" aria-hidden="true">·</span>}
        <span className={`ib-config-value ${isDefault(value) ? 'is-default' : ''}`}
          style={colors[value] ? { '--ib-field-color': colors[value] } : undefined}>{value}</span>
      </React.Fragment>)}
    </div>
  );
}
