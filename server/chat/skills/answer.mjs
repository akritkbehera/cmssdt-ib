// ANSWER skill (v1): build a compact evidence bundle from query results and
// steer the final answer from it.
//
// The bundle carries result rows or aggregates, query scope, source datasets
// and completeness metadata, and it classifies outcomes so the answer can
// distinguish: zero matching failures, an export with incomplete coverage,
// missing per-test details, and a failed query. For "latest" questions the
// bundle records the time scope of the data actually used. All identifiers
// (build IDs, architectures, statuses, test names) are preserved verbatim from
// the query results; nothing is normalized or invented here.

export const OUTCOMES = ['complete', 'partial', 'export_incomplete_coverage', 'missing_per_test_details', 'aggregate_only', 'zero_matches', 'query_failed'];

// Compact, deterministic row trimming: identifiers and enums stay verbatim,
// long free text is capped, row count is bounded.
export function trimRows(rows, { maxRows = 50, maxValue = 160 } = {}) {
  return (rows || []).slice(0, maxRows).map(row => Object.fromEntries(Object.entries(row)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, typeof value === 'string' && value.length > maxValue ? `${value.slice(0, maxValue)}…` : value])));
}

function timeBounds(rows, timeField) {
  if (!timeField) return { from: null, to: null };
  const values = (rows || []).map(row => row[timeField]).filter(value => typeof value === 'string' || typeof value === 'number').map(String).sort();
  return values.length ? { from: values[0], to: values[values.length - 1] } : { from: null, to: null };
}

// Classify what the evidence can and cannot support. Distinguishes the four
// mandated cases plus the richer coverage states:
//   - query_failed: at least one scoped query did not succeed (nothing may be
//     inferred from it, least of all "no failures");
//   - zero_matches: every scoped query succeeded and matched nothing;
//   - missing_per_test_details: the answer needs per-test granularity but the
//     only available evidence is aggregate-only;
//   - export_incomplete_coverage: rows exist but the source declares partial
//     coverage (e.g. an export that did not include every test);
//   - aggregate_only / partial / complete otherwise.
export function classifyCompleteness({ route, results, needsPerTestDetail, catalog }) {
  const failures = results.filter(result => result.outcome !== 'success');
  const successes = results.filter(result => result.outcome === 'success');
  const datasetById = new Map((catalog?.datasets || []).map(dataset => [dataset.datasetId, dataset]));
  const details = [];
  if (failures.length) {
    for (const failure of failures) {
      details.push(`query on '${failure.plan?.ir?.datasetId || 'unknown'}' failed (${failure.outcome}${failure.detail ? `: ${failure.detail}` : ''})`);
    }
    return { status: 'query_failed', details, failed: failures.map(failure => ({ dataset: failure.plan?.ir?.datasetId || null, outcome: failure.outcome, detail: failure.detail || null })) };
  }
  const totalRows = successes.reduce((sum, result) => sum + (result.rows?.length || 0) + (result.aggregate?.buckets?.length || 0), 0);
  const perTestSources = successes
    .filter(result => (result.rows?.length || 0) > 0 && datasetById.get(result.plan.ir.datasetId)?.granularity === 'test')
    .map(result => result.plan.ir.datasetId);
  const aggregateOnlySources = successes
    .map(result => result.plan.ir.datasetId)
    .filter(id => datasetById.get(id)?.coverage === 'aggregate_only');
  const partialSources = successes
    .map(result => ({ id: result.plan.ir.datasetId, coverage: datasetById.get(result.plan.ir.datasetId)?.coverage }))
    .filter(entry => entry.coverage === 'partial' || entry.coverage === 'unknown');

  if (totalRows === 0) {
    details.push('all scoped queries succeeded and matched no records');
    return { status: 'zero_matches', details };
  }
  if (needsPerTestDetail && !perTestSources.length &&
      (aggregateOnlySources.length || route?.completeness === 'aggregate_only' || successes.some(result => result.aggregate && !(result.rows?.length)))) {
    details.push(`the requested per-test detail is not present; '${(aggregateOnlySources.length ? aggregateOnlySources : successes.map(result => result.plan.ir.datasetId)).join("', '")}' carries aggregate counts only`);
    return { status: 'missing_per_test_details', details, aggregateOnlySources };
  }
  if (partialSources.length) {
    for (const source of partialSources) details.push(`dataset '${source.id}' declares ${source.coverage} coverage; results may not include every record`);
    return { status: 'export_incomplete_coverage', details, partialSources: partialSources.map(entry => entry.id) };
  }
  if (aggregateOnlySources.length && !perTestSources.length) {
    details.push(`counts only from '${aggregateOnlySources.join("', '")}'; no per-test detail in scope`);
    return { status: 'aggregate_only', details, aggregateOnlySources };
  }
  details.push('all scoped queries succeeded');
  return { status: 'complete', details };
}

export function buildEvidenceBundle({ question, routing, results, combined = null, catalog, retrievedAt = null, timeField = null, needsPerTestDetail = false }) {
  const route = routing?.bundle?.route || null;
  const completeness = classifyCompleteness({ route, results, needsPerTestDetail, catalog });
  const successes = results.filter(result => result.outcome === 'success');
  const rows = combined?.rows?.length ? combined.rows : successes.flatMap(result => result.rows || []);
  const datasetTimeField = timeField || catalog?.datasets?.find(dataset => route?.datasets?.includes(dataset.datasetId))?.timeField || null;
  const bounds = timeBounds(rows, datasetTimeField);
  return {
    question: String(question || '').slice(0, 300),
    intent: routing?.intent || null,
    routeId: routing?.routeId || null,
    params: routing?.params || {},
    scope: results.map(result => ({
      dataset: result.plan?.ir?.datasetId || null, index: result.plan?.ir?.index || null,
      transport: result.plan?.ir?.transport || null, template: result.plan?.ir?.templateId || null,
      filters: (result.plan?.ir?.filters || []).map(filter => filter.op === 'range'
        ? `${filter.field} in [${filter.from ?? '*'} .. ${filter.to ?? '*'}]`
        : `${filter.field} ${filter.op === 'not_term' ? '!=' : filter.op === 'prefix' ? 'starts with' : '='} ${JSON.stringify(filter.value)}`),
    })),
    sources: [...new Map(results.map(result => {
      const dataset = catalog?.datasets?.find(entry => entry.datasetId === result.plan?.ir?.datasetId);
      return [result.plan?.ir?.datasetId, { dataset: result.plan?.ir?.datasetId || null, index: result.plan?.ir?.index || null,
        granularity: dataset?.granularity || null, coverage: dataset?.coverage || null }];
    })).values()],
    results: results.map(result => result.outcome === 'success'
      ? { dataset: result.plan.ir.datasetId, outcome: 'success', total: result.total ?? null, bounded: Boolean(result.bounded),
          rows: trimRows(result.rows), aggregate: result.aggregate ? result.aggregate.buckets.slice(0, 20) : null }
      : { dataset: result.plan?.ir?.datasetId || null, outcome: result.outcome, detail: result.detail || null }),
    combined: combined ? { combined: Boolean(combined.combined), join: combined.join || null, reason: combined.reason || null, unmatched: combined.unmatched ?? null } : null,
    completeness,
    timeScope: { dataFrom: bounds.from, dataTo: bounds.to, retrievedAt: retrievedAt || new Date().toISOString(),
      requestedWindow: routing?.params?.time_window || null },
  };
}

// Bounded textual rendering of the bundle — the compact evidence handed to the
// model (and to the deterministic mock model in the replay evaluation).
export function renderEvidence(bundle, { maxChars = 8000 } = {}) {
  const lines = [
    `Question: ${bundle.question}`,
    `Route: ${bundle.routeId || 'none'} (intent ${bundle.intent || 'unknown'}) | Parameters: ${JSON.stringify(bundle.params)}`,
    `Evidence status: ${bundle.completeness.status}${bundle.completeness.details.length ? ` — ${bundle.completeness.details.join('; ')}` : ''}`,
    `Time scope of the data used: ${bundle.timeScope.dataFrom ?? 'unknown'} .. ${bundle.timeScope.dataTo ?? 'unknown'} (retrieved ${bundle.timeScope.retrievedAt})${bundle.timeScope.requestedWindow ? ` | requested window: ${JSON.stringify(bundle.timeScope.requestedWindow)}` : ''}`,
  ];
  for (const source of bundle.sources) {
    lines.push(`Source: dataset ${source.dataset} (index ${source.index}, granularity ${source.granularity}, coverage ${source.coverage})`);
  }
  for (const scope of bundle.scope) {
    lines.push(`Query scope [${scope.dataset}]: ${scope.filters.join(' AND ') || 'no filters'}${scope.aggregate ? ` | aggregate ${scope.aggregate}` : ` | rows<=${scope.size}`}`);
  }
  for (const result of bundle.results) {
    if (result.outcome !== 'success') { lines.push(`Result[${result.dataset}]: FAILED (${result.outcome}${result.detail ? `: ${result.detail}` : ''})`); continue; }
    if (result.aggregate) {
      lines.push(`Result[${result.dataset}]: ${result.aggregate.length} groups (total ${result.total ?? 'unknown'}${result.bounded ? ', truncated at group limit' : ''})`);
      for (const bucket of result.aggregate) lines.push(`  ${JSON.stringify(bucket)}`);
    } else {
      lines.push(`Result[${result.dataset}]: ${result.rows.length} rows (total ${result.total ?? 'unknown'}${result.bounded ? ', truncated at row limit' : ''})`);
      for (const row of result.rows.slice(0, 30)) lines.push(`  ${JSON.stringify(row)}`);
      if (result.rows.length > 30) lines.push(`  … ${result.rows.length - 30} more rows`);
    }
  }
  if (bundle.combined) {
    lines.push(bundle.combined.combined
      ? `Combined on verified join ${bundle.combined.join.left} == ${bundle.combined.join.right} @ ${bundle.combined.join.granularity} (${bundle.combined.join.confidence})${bundle.combined.unmatched ? `, ${bundle.combined.unmatched} left rows unmatched` : ''}`
      : `Results kept separate: ${bundle.combined.reason}`);
  }
  return lines.join('\n').slice(0, maxChars);
}
