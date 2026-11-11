import useHistoryNavigation from './useHistoryNavigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

function DateCard({ group, renderTable, report }) {
  const root = useRef(null);
  const [range, setRange] = useState({first: 1, last: 1, total: 1, left: false, right: false});
  const counts = useCallback(value => report(group.key, value), [report, group.key]);
  useEffect(() => {
    const box = root.current.querySelector('.ib-table-responsive');
    if (!box) return;
    const update = () => {
      const headers = [...box.querySelectorAll('th.ib-config-header')];
      const edge = box.getBoundingClientRect(), rail = box.querySelector('.name-column')?.getBoundingClientRect().width || 0;
      const visible = headers.map((el, index) => ({r:el.getBoundingClientRect(), index}))
        .filter(({r}) => r.left >= edge.left + rail - 2 && r.right <= edge.right + 2);
      setRange({first: visible[0]?.index + 1 || 1, last: visible.at(-1)?.index + 1 || 1,
        total: headers.length, left: box.scrollLeft > 1, right: box.scrollLeft + box.clientWidth < box.scrollWidth - 2});
    };
    const observer = new ResizeObserver(update);
    observer.observe(box); box.addEventListener('scroll', update, {passive:true}); update();
    return () => {observer.disconnect(); box.removeEventListener('scroll', update);};
  }, [group]);
  const move = direction => {
    const box = root.current.querySelector('.ib-table-responsive');
    const width = box?.querySelector('th.ib-config-header')?.getBoundingClientRect().width || 120;
    box?.scrollBy({left: direction * width, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  };
  return <article ref={root} className={`ib-history-date-card ${group.differentTimes ? 'is-latest-fallback' : ''}`} aria-label={group.title}>
    <header className="ib-history-date-handle">
      <strong>{group.title}</strong>
      <small>{group.differentTimes ? 'Different timestamps · latest of each flavour' : 'Swipe this header to browse dates'}</small>
    </header>
    <div className="ib-history-inner-controls" aria-label="Configuration navigation">
      <button type="button" disabled={!range.left} onClick={() => move(-1)} aria-label="Previous configuration">←</button>
      <small>Configurations {range.first}–{range.last} of {range.total}</small>
      <button type="button" disabled={!range.right} onClick={() => move(1)} aria-label="Next configuration">→</button>
    </div>
    {renderTable(group.builds, counts)}
  </article>;
}

export default function HistoryCards({groups, renderTable, onCountsChange}) {
  const {track, active, atEnd, move} = useHistoryNavigation(groups.map(group=>group.key).join('|'));
  const [totals, setTotals] = useState({});
  const report = useCallback((key, value) => setTotals(previous =>
    JSON.stringify(previous[key]) === JSON.stringify(value) ? previous : {...previous, [key]:value}), []);
  useEffect(() => {
    const total = {success:0, danger:0, warning:0, secondary:0, info:0};
    for (const group of groups) for (const key of Object.keys(total)) total[key] += totals[group.key]?.[key] || 0;
    onCountsChange(total);
  }, [groups, totals, onCountsChange]);
  return <div className="ib-history-card-browser">
    <nav className="ib-history-date-controls" aria-label="Date navigation">
      <button type="button" disabled={!active} onClick={() => move(-1)}>← Newer</button>
      <span aria-live="polite">{active + 1} / {groups.length} · Newest → oldest</span>
      <button type="button" disabled={groups.length < 2 || atEnd} onClick={() => move(1)}>Older →</button>
    </nav>
    <div ref={track} className="ib-history-date-track">
      {groups.map(group => <DateCard key={group.key} group={group} renderTable={renderTable} report={report} />)}
    </div>
  </div>;
}
