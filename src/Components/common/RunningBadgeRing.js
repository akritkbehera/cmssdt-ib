import React from 'react';

/** Moving stroke follows the pill perimeter without rotating or repainting a mask. */
export default function RunningBadgeRing() {
  return <svg className="ib-running-badge-ring" aria-hidden="true" focusable="false">
    <rect className="ib-running-ring-base" x="3" y="3" rx="999" pathLength="100"/>
    <rect className="ib-running-ring-streak" x="3" y="3" rx="999" pathLength="100"/>
  </svg>;
}
