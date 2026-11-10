import React from 'react';

// Keep named metrics separate; never add incompatible counts together.
export default function ResultDeltaGutter({metrics = [], detail}) {
  return <div className="ib-cell-comparison" tabIndex={0} aria-label={detail}>
    {[['negative', value => value < 0], ['positive', value => value > 0]].map(([sign, matches]) => {
      const values = metrics.filter(metric => matches(metric.delta));
      return values.length ? <span key={sign} className={`ib-delta-slot ib-delta-slot--${sign}`} data-sign={sign}
        title={values.map(metric => `${metric.key}: ${metric.previous} → ${metric.current} (${metric.label})`).join('; ')}>
        {values.map((metric, index) => <React.Fragment key={metric.key}>{index > 0 ? ' ' : ''}<span className="ib-result-delta">{metric.label}</span></React.Fragment>)}
      </span> : null;
    })}
  </div>;
}
