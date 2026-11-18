// Deterministic scripted model adapters for the replay evaluation.
//
// These stand in for the CERN AI Gateway/Kimi model so the evaluation runs
// offline with reproducible behavior. They are NOT the model under test: they
// encode the behavior contract of each workflow so the harness can measure the
// pipeline around them (routing, plan validity, tool calls, answer content).
//
// - `graph` mode answers strictly from the rendered evidence bundle (mimicking
//   a model following the ANSWER prompt v1) and emits structured plans from the
//   retrieved graph entries when asked (QUERY prompt v1 contract).
// - `legacy` mode mimics the pre-graph plain tool loop: it discovers indices
//   and mappings per question, queries with guessed arguments, never asks
//   clarifying questions, treats empty per-test exports as "no failures", and
//   does not report time scope or export coverage.
import { detectIntent } from '../skills/route.mjs';

const streamOf = events => (async function* () { for (const event of events) yield event; })();

// ---------------------------------------------------------------------------
// Evidence-bundle answering (graph mode)
// ---------------------------------------------------------------------------

// Parse the rendered evidence text produced by skills/answer.mjs — the mock
// model only ever sees what the prompt contains.
export function parseEvidenceText(text) {
  const status = /Evidence status: ([a-z_]+)/.exec(text)?.[1] || 'complete';
  const details = /Evidence status: [a-z_]+ — ([^\n]+)/.exec(text)?.[1] || '';
  const timeScope = /Time scope of the data used: ([^\n]+)/.exec(text)?.[1] || '';
  const sources = [...text.matchAll(/^Source: dataset (\S+) \(index (\S+), granularity (\S+), coverage (\S+)\)/gm)]
    .map(match => ({ dataset: match[1], index: match[2], granularity: match[3], coverage: match[4] }));
  const scopes = [...text.matchAll(/^Query scope \[(\S+)\]: ([^\n]+)/gm)].map(match => ({ dataset: match[1], scope: match[2] }));
  const rows = [];
  const buckets = [];
  let current = null;
  for (const line of text.split('\n')) {
    const head = /^Result\[(\S+)\]: (.+)$/.exec(line);
    if (head) { current = { dataset: head[1], meta: head[2] }; continue; }
    const body = /^\s+(\{.*\})\s*$/.exec(line);
    if (body && current) {
      try {
        const parsed = JSON.parse(body[1]);
        if ('count' in parsed && 'key' in parsed) buckets.push({ dataset: current.dataset, ...parsed });
        else rows.push({ dataset: current.dataset, ...parsed });
      } catch { /* skip non-JSON */ }
    }
    if (/^Result\[\S+\]: FAILED/.test(line)) {
      const failed = /^Result\[(\S+)\]: FAILED \((.+)\)$/.exec(line);
      if (failed) current = { dataset: failed[1], failed: failed[2] };
    }
  }
  const failures = [...text.matchAll(/^Result\[(\S+)\]: FAILED \(([^\n]+)\)/gm)].map(match => ({ dataset: match[1], detail: match[2] }));
  return { status, details, timeScope, sources, scopes, rows, buckets, failures };
}

// A compliant ANSWER-prompt-v1 response: classification-accurate, cites the
// source dataset and filters, preserves identifiers verbatim, and states the
// time scope of the data used for "latest" questions.
export function graphAnswer(question, evidenceText) {
  const evidence = parseEvidenceText(evidenceText);
  const lines = [];
  const cite = evidence.sources.map(source => `${source.dataset} (index ${source.index})`).join(', ') || 'the queried datasets';
  const scopes = evidence.scopes.map(scope => `[${scope.dataset}] ${scope.scope}`).join('; ');
  switch (evidence.status) {
    case 'query_failed':
      lines.push(`The query failed, so I cannot report results for "${question}".`);
      for (const failure of evidence.failures) lines.push(`- ${failure.dataset}: ${failure.detail}`);
      lines.push(`Sources attempted: ${cite}. Query scope: ${scopes || 'n/a'}.`);
      break;
    case 'zero_matches':
      lines.push(`No matching records in the queried scope — the queries succeeded but matched nothing, so there are zero matching failures in that scope.`);
      lines.push(`Sources: ${cite}. Query scope: ${scopes || 'n/a'}.`);
      break;
    case 'missing_per_test_details':
      lines.push(`Per-test details are missing from the available data: only aggregate counts are present.`);
      if (evidence.rows.length) {
        lines.push('Aggregate counts:');
        for (const row of evidence.rows) lines.push(`- ${JSON.stringify(row)}`);
      }
      lines.push(`Sources: ${cite}. Query scope: ${scopes || 'n/a'}.`);
      break;
    case 'export_incomplete_coverage':
      lines.push(`The export has incomplete coverage; results below may not include every record.`);
      lines.push(...resultLines(evidence));
      lines.push(`Sources: ${cite}. Query scope: ${scopes || 'n/a'}.`);
      break;
    case 'aggregate_only':
      lines.push('Aggregate counts only (no per-test detail in scope):');
      lines.push(...resultLines(evidence));
      lines.push(`Sources: ${cite}. Query scope: ${scopes || 'n/a'}.`);
      break;
    default:
      lines.push(`From the queried data:`);
      lines.push(...resultLines(evidence));
      lines.push(`Sources: ${cite}. Query scope: ${scopes || 'n/a'}.`);
  }
  if (/latest|newest|most recent/i.test(question) && evidence.timeScope) {
    lines.push(`Time scope of the data used: ${evidence.timeScope}.`);
  }
  return lines.join('\n');
}

function resultLines(evidence) {
  const lines = [];
  for (const row of evidence.rows) {
    const { dataset, __dataset, ...rest } = row;
    lines.push(`- [${dataset || __dataset || 'row'}] ${JSON.stringify(rest)}`);
  }
  for (const bucket of evidence.buckets) {
    lines.push(`- [${bucket.dataset}] ${bucket.key}: ${bucket.count}`);
  }
  if (!evidence.rows.length && !evidence.buckets.length) lines.push('- (no rows)');
  return lines;
}

// ---------------------------------------------------------------------------
// Structured plan production (QUERY prompt v1 contract)
// ---------------------------------------------------------------------------

// Build a plan referencing only retrieved dataset/field ids found in the query
// prompt's "Graph entries" section.
export function modelPlanFromPrompt(userMessage) {
  const params = JSON.parse(/Parameters: (\{[^\n]*\})/.exec(userMessage)?.[1] || '{}');
  const fields = [...userMessage.matchAll(/^- ([\w.:-]+) :: (\S+)\.(\S+) \((\w+)([^)]*)\)(?: \[role (\w+)\])?/gm)]
    .map(match => ({ id: match[1], dataset: match[2], name: match[3], type: match[4], exact: /exact-match/.test(match[5]), role: match[6] || null }));
  const datasets = [...userMessage.matchAll(/^Dataset (\S+): index (\S+), granularity (\S+)/gm)]
    .map(match => ({ id: match[1], index: match[2], granularity: match[3] }));
  const question = /Question:\n([^\n]+)/.exec(userMessage)?.[1] || '';
  const intent = detectIntent(question);
  const wantDataset = /relval|workflow/i.test(question) ? /relval/
    : /unit ?test|utest/i.test(question) ? (/\b(which|what|names?|per[- ]test|each test|individual)\b/i.test(question) ? /unit_test_results/ : /unit_test_summaries|unit_test_results/)
    : /jenkins|job/i.test(question) ? /jenkins/ : /ib_builds/;
  const dataset = datasets.find(entry => wantDataset.test(entry.id)) || datasets[0];
  const inDataset = fields.filter(field => field.dataset === dataset?.id);
  const filters = [];
  const find = role => inDataset.find(field => field.role === role);
  const addTerm = (field, value) => { if (field && value !== undefined) filters.push({ field_id: field.id, op: 'term', value }); };
  addTerm(find('build_id'), params.build);
  addTerm(find('architecture'), params.architecture);
  if (params.series && !params.build) {
    const field = find('build_id');
    if (field) filters.push({ field_id: field.id, op: 'prefix', value: params.series });
  }
  if (params.time_window) {
    const field = find('timestamp');
    if (field) filters.push({ field_id: field.id, op: 'range', from: params.time_window.from || null, to: params.time_window.to || null });
  }
  if (/fail/i.test(question)) {
    const exitcode = inDataset.find(field => field.name === 'exitcode');
    if (exitcode) filters.push({ field_id: exitcode.id, op: 'not_term', value: 0 });
  }
  const select = inDataset.slice(0, 8).map(field => field.id);
  const sortField = find('timestamp');
  return {
    dataset_id: dataset?.id || null,
    filters,
    select,
    sort: sortField ? [{ field_id: sortField.id, order: 'desc' }] : [],
    aggregate: /how many|per workflow|count/i.test(question) && intent === 'relval_failure_aggregation'
      ? { field_id: (inDataset.find(field => field.name === 'workflow') || {}).id, size: 20 } : null,
    size: 50,
  };
}

// ---------------------------------------------------------------------------
// Legacy plain-loop behavior (baseline mode)
// ---------------------------------------------------------------------------

function lastUser(messages) {
  return [...messages].reverse().find(message => message.role === 'user')?.content || '';
}
// Correlate tool results with the tool calls that produced them (by
// tool_call_id), so the scripted loop knows which tools have already run.
function toolResults(messages) {
  const nameById = new Map();
  for (const message of messages) {
    for (const call of message.tool_calls || []) nameById.set(call.id, call.function?.name);
  }
  return messages.filter(message => message.role === 'tool')
    .map(message => ({ name: nameById.get(message.tool_call_id) || null, content: message.content || '' }));
}

// Guess the legacy query arguments from the question and discovered mapping.
// Everything the question does not state comes from `context` — the fixture
// set's own index names and release identifiers — never from constants: the
// baseline must not get fixture-specific knowledge handed to it.
export function legacySearch(question, mappingFields, context = {}) {
  const intent = detectIntent(question);
  const has = name => mappingFields.includes(name);
  const build = /\bCMSSW_[0-9]+_[0-9]+(?:_[A-Z0-9]+)?_X_[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}\b/.exec(question)?.[0];
  const series = /\bCMSSW[_ ]([0-9]{1,2})[._]([0-9]{1,2})/i.exec(question);
  const arch = /\b(?:el[0-9]|slc[0-9])[a-z0-9]*_(?:amd64|aarch64|x86_64)_[a-z0-9]+\b/i.exec(question)?.[0]?.toLowerCase();
  const filter = [];
  if (intent === 'jenkins_jobs') {
    // A plain-loop user queries the job fields the mapping actually shows.
    if (/\bfail/i.test(question) && has('status')) filter.push({ bool: { must_not: [{ term: { status: 'SUCCESS' } }] } });
    if (has('timestamp') && context.windowStart) filter.push({ range: { timestamp: { gte: context.windowStart } } });
  } else {
    const releaseField = has('release_name') ? 'release_name' : 'release';
    if (build) filter.push({ term: { [releaseField]: build } });
    else if (series) filter.push({ prefix: { [releaseField]: `CMSSW_${series[1]}_${series[2]}_` } });
    else if (context.defaultSeriesPrefix) filter.push({ prefix: { [releaseField]: context.defaultSeriesPrefix } });
    if (arch && has('arch')) filter.push({ term: { arch } });
    if (['unit_test_failures', 'relval_failures', 'relval_failure_aggregation'].includes(intent) && has('exitcode')) {
      filter.push({ bool: { must_not: [{ term: { exitcode: 0 } }] } });
    }
  }
  const index = context.indexFor ? context.indexFor(intent) : null;
  return { index, query: { bool: { filter } }, size: intent === 'compare_builds' || intent === 'compare_flavours' ? 4 : 20 };
}

// Legacy answer: plain rows, no completeness distinctions, no time scope,
// no clarification, and empty per-test exports read as "no failures".
export function legacyAnswer(question, results) {
  const intent = detectIntent(question);
  const failures = results.filter(result => result.error);
  if (failures.length) return `The query failed: ${failures.map(failure => failure.error).join('; ')}`;
  const rows = results.flatMap(result => result.rows || []);
  if (!rows.length) {
    return /unit ?test/i.test(question) ? 'No failed unit tests found.'
      : /relval|workflow/i.test(question) ? 'No failing RelVals found.'
      : 'No records found.';
  }
  if (intent === 'latest_ib' || intent === 'build_status') {
    const row = rows[0];
    return `The latest IB for ${row.release_queue || 'the cycle'} is ${row.release_name}${row.status ? ` and its status is ${row.status}` : ''}.`;
  }
  if (intent === 'compare_flavours' || intent === 'compare_builds') {
    return `Comparison of the retrieved builds:\n${rows.map(row => `- ${row.release_name} (${row.release_queue || ''} ${row.arch || ''}) status ${row.status}`).join('\n')}`;
  }
  if (intent === 'relval_failure_aggregation') {
    return `RelVal failures per workflow:\n${rows.map(row => `- ${row.workflow || row.key}: ${row.count ?? row.total ?? ''}`).join('\n')}`;
  }
  return `${rows.length} record(s):\n${rows.map(row => `- ${JSON.stringify(row)}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// Mock OpenAI-compatible clients
// ---------------------------------------------------------------------------

export function createGraphModel({ now } = {}) {
  return {
    chat: { completions: { create: async (params) => {
      const messages = params.messages || [];
      const userMessage = messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
      if (params.stream) {
        const evidenceText = /Evidence bundle:\n([\s\S]*)\n\nQuestion:/.exec(userMessage)?.[1] || userMessage;
        const question = /Question: ([^\n]*)\n\nAnswer:/.exec(userMessage)?.[1] || '';
        const text = graphAnswer(question, evidenceText);
        return streamOf([{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }]);
      }
      const content = JSON.stringify(modelPlanFromPrompt(userMessage));
      return { choices: [{ message: { content }, finish_reason: 'stop' }] };
    } } },
  };
}

export function createLegacyModel({ set = null, now = null } = {}) {
  // Context derived from the fixture set at runtime — the baseline gets the
  // same observable surface a real deployment would show (index names from
  // ListIndexTool, identifiers found in the data), not hardcoded constants.
  const indexNames = set ? Object.keys(set.data) : [];
  const allDocs = set ? Object.values(set.data).flat() : [];
  const releaseNames = allDocs.map(doc => doc.release_name).filter(Boolean).sort();
  const timestamps = allDocs.map(doc => doc.timestamp || doc.ib_date).filter(Boolean).sort();
  const guessedFields = allDocs.length ? Object.keys(allDocs[0]) : [];
  const context = {
    defaultSeriesPrefix: releaseNames[0] ? releaseNames[0].split('_').slice(0, 3).join('_') + '_' : null,
    windowStart: timestamps.length ? String(timestamps[timestamps.length - 1]).slice(0, 10) : null,
    indexFor: intent => {
      const wanted = { unit_test_failures: /utests/, relval_failures: /relval/, relval_failure_aggregation: /relval/,
        jenkins_jobs: /jenkins/ }[intent];
      return (wanted ? indexNames.find(name => wanted.test(name)) : null) || indexNames[0] || null;
    },
  };
  return {
    chat: { completions: { create: async (params) => {
      const messages = params.messages || [];
      const question = lastUser(messages);
      const done = toolResults(messages);
      const byName = name => done.filter(entry => entry.name === name);
      const mappingText = byName('IndexMappingTool').map(entry => entry.content).join('\n');
      const mappingFields = [...mappingText.matchAll(/"([A-Za-z_@][A-Za-z0-9_.]*)":\s*\{/g)].map(match => match[1]);
      // Scripted plain-loop behavior: discover, query, answer. Never clarify.
      if (!byName('ListIndexTool').length) {
        return streamOf(toolEvent('ListIndexTool', {}));
      }
      if (!byName('IndexMappingTool').length) {
        // A reasonable baseline discovers the mapping of the index it is about
        // to search (falling back to the first listed index).
        const indices = safeJson(byName('ListIndexTool')[0].content) || indexNames.slice(0, 1);
        const target = context.indexFor ? context.indexFor(detectIntent(question)) : null;
        const chosen = target || (Array.isArray(indices) ? indices[0] : indexNames[0]);
        return streamOf(toolEvent('IndexMappingTool', { index: chosen }));
      }
      const searchResults = byName('SearchIndexTool').map(entry => parseSearchPayload(entry.content)).filter(Boolean);
      const needsTwo = /compare/i.test(question);
      if (searchResults.length < (needsTwo ? 2 : 1)) {
        const args = legacySearch(question, mappingFields.length ? mappingFields : guessedFields, context);
        return streamOf(toolEvent('SearchIndexTool', args));
      }
      const text = legacyAnswer(question, searchResults);
      return streamOf([{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }]);
    } } },
  };
}

const toolEvent = (name, args) => ([
  { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] },
]);

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function parseSearchPayload(text) {
  const payload = safeJson(text);
  if (!payload) return null;
  if (payload.error) return { error: typeof payload.error === 'string' ? payload.error : payload.error.type || 'error' };
  if (payload.hits?.hits) return { rows: payload.hits.hits.map(hit => hit._source || {}) };
  return null;
}
