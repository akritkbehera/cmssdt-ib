import React from 'react';

export default function ArchitectureHeader({ architecture, icon }) {
  const [platform, ...toolchain] = architecture.split('_');
  return (
    <div className="ib-architecture-header" aria-label={architecture}>
      <span className="ib-architecture-platform">{icon && <span className="ib-build-kind">{icon}</span>}{platform}</span>
      <span className="ib-architecture-toolchain">{toolchain.map((value, index) => <span className="ib-architecture-value" key={`${value}-${index}`}>{value}</span>)}</span>
    </div>
  );
}
