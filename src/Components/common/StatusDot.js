import React from 'react';

/** Shared, stationary state mark with motion confined to the surrounding circle. */
export default function StatusDot({ status = 'secondary', running = false, size = 24, solid = false }) {
  const paths = {
    success: 'M3.5 8.4l3 3 6-6.4',
    danger: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
    warning: 'M8 3.2v5.6M8 12.4h.01',
    secondary: 'M4 8h8'
  };
  return (
    <span className={`ib-state-dot ib-status-${status} ${running ? 'is-running' : ''} ${solid ? 'is-solid' : ''}`}
      style={{ '--dot-size': `${size}px`, '--dot-stroke': size < 22 ? '1.5px' : '2px' }} aria-hidden="true">
      <span className="ib-dot-pulse" />
      <span className="ib-dot-sweep" />
      <span className="ib-dot-mark">
        {status === 'info' ? <span className="ib-dot-pin" /> : (
          <svg viewBox="0 0 16 16" fill="none"><path d={paths[status] || paths.secondary} /></svg>
        )}
      </span>
    </span>
  );
}
