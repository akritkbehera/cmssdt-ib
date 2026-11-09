import React, { useEffect, useState } from 'react';
import { getMultipleFiles } from '../../Utils/ajax';
import { urls } from '../../relValConfig';
import { resultSnapshot, snapshotMatches, previewGroups } from '../../Utils/resultPreview';

const sections = [
  ['newFailures', 'Newly failing', 'danger'], ['fixed', 'Fixed — now passing', 'success'],
  ['stillFailing', 'Still failing', 'danger'], ['failing', 'Failing', 'danger'],
  ['warnings', 'Known failures / warnings', 'warning'], ['passing', 'Other passing', 'success']
];
const resultUrl = (stage, ib, arch) => {
  const date = /_(\d{4}-\d{2}-\d{2}-\d{4})$/.exec(ib.release_name)?.[1];
  if (!date) throw new Error('Unknown build date');
  return `${urls.relValDataDir}${stage === 'relvals' ? 'relvals' : 'unitTests'}/${arch}/${date}/${ib.release_queue}.json`;
};

// Mounted by the tooltip/dialog only when requested; reuse the application's JSON cache.
export default function ResultChangePreview({ stage, arch, ib, previousIb, current, previous }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    Promise.resolve().then(() => getMultipleFiles({ fileUrlList: [resultUrl(stage, ib, arch), resultUrl(stage, previousIb, arch)] }))
      .then(responses => {
        const now = resultSnapshot(stage, responses[0]?.data), before = resultSnapshot(stage, responses[1]?.data);
        if (!snapshotMatches(stage, now, current) || !snapshotMatches(stage, before, previous)) throw new Error('Details do not match the reported totals');
        if (!cancelled) setState({ groups: previewGroups(now, before) });
      }).catch(() => { if (!cancelled) setState({ error: true }); });
    return () => { cancelled = true; };
  }, [stage, arch, ib, previousIb, current, previous]);
  return <div className="ib-change-preview">
    <strong>Result changes</strong>
    <div className="ib-preview-baseline">Compared with {previousIb.release_name}</div>
    {state.loading && <p role="status">Loading result names…</p>}
    {state.error && <p role="status">Detailed results unavailable or do not match these build totals. Open logs for details.</p>}
    {state.groups && <>
      {sections.map(([key, title, tone]) => state.groups[key].length > 0 && <section key={key} className={`ib-preview-${tone}`}>
        <strong>{title} · {state.groups[key].length} {stage === 'utests' ? 'packages' : 'workflows'}</strong>
        <ul>{state.groups[key].slice(0, 6).map(item => <li key={item.key}>{item.label}</li>)}</ul>
        {state.groups[key].length > 6 && <span>+{state.groups[key].length - 6} more</span>}
      </section>)}
      {Object.values(state.groups).every(items => !items.length) && <p>No completed results to preview.</p>}
      <small>Missing or unfinished items are not counted as fixed.</small>
    </>}
  </div>;
}
