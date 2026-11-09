import React from 'react';

export default function ComparisonContext({ builds, comparisons }) {
  const latest = builds.filter(build => build.isIB === true && comparisons.get(build)?.latest);
  if (!latest.length) return null;
  const comparisonLine = build => {
    const context = comparisons.get(build);
    return <div key={build.release_name}><span className="ib-comparison-series">{build.release_queue}: </span>
      {context.previous ? <>Compared with <code>{context.previous.release_name}</code></> : context.reason}
    </div>;
  };
  return <div className="ib-comparison-context" onClick={event => event.stopPropagation()}>
    {comparisonLine(latest[0])}
    {latest.length > 1 && <details><summary>Comparison baselines for {latest.length - 1} more variants</summary>{latest.slice(1).map(comparisonLine)}</details>}
  </div>;
}
