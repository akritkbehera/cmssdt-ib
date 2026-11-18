// Replay evaluation runner: same fixtures, two workflows.
//
//   baseline — the existing plain tool loop (discover indices/mappings, query,
//              answer) driven by a scripted model stand-in.
//   graph    — the ROUTE -> QUERY -> ANSWER pipeline over the versioned
//              catalog, with the same scripted model standing in for Kimi.
//
// Every run is offline: queries execute against the fixture store, and the
// "model" is a deterministic scripted adapter. Measured latency is therefore
// MOCKED transport/model timing and is labeled as such in every record.
//
// Metrics per case:
//   routeFirstAttempt  routing decision + route id on the first pipeline pass
//   fieldAccuracy      recall of expected field names over the fields actually
//                      used in the issued queries (both workflows)
//   validPlan          a plan compiled and executed without plan-level
//                      rejection (graph only; baseline has no plan stage)
//   answerCorrect      all answer checks pass (identifiers, citations,
//                      completeness distinctions, abstentions)
//   toolCalls          total read-only tool invocations
//   latencyMs          wall clock, MOCKED (label carried in every record)
// Stages a workflow does not have (e.g. routing for the baseline) are marked
// 'unevaluable', never guessed.
import { loadFixtureSet, loadFixtureCatalog, createFixtureMcpClient, createFixturePplExecute, executePplFixture, SEARCH_TOOL_SCHEMA } from './fixture-store.mjs';
import { createGraphModel, createLegacyModel } from './mock-model.mjs';
import { runGraphPipeline, planQueries } from '../graph/pipeline.mjs';
import { routeQuestion } from '../skills/route.mjs';
import { parseCatalog } from '../graph/catalog.mjs';
import { loadPromptBundle } from '../skills/prompts.mjs';
import { PPL_TOOL_NAME } from '../ppl.mjs';
import { FIXED_NOW, FIXED_RETRIEVED_AT } from './cases.mjs';

export const LATENCY_LABEL = 'mocked-transport-and-mock-model';

// ---------------------------------------------------------------------------
// Field usage extraction (identical for both workflows: fields in the queries
// actually issued through the read-only tools)
// ---------------------------------------------------------------------------

const QUERY_CONTAINERS = new Set(['bool', 'filter', 'must', 'must_not', 'should', 'query', 'aggs', 'aggregations', 'groups']);
const QUERY_CLAUSES = new Set(['term', 'prefix', 'range', 'exists', 'match', 'match_phrase']);
const AGG_FUNCTIONS = new Set(['min', 'max', 'sum', 'avg', 'value_count', 'cardinality']);

function collectQueryFields(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const entry of node) collectQueryFields(entry, out); return; }
  for (const [key, value] of Object.entries(node)) {
    if (QUERY_CLAUSES.has(key) && value && typeof value === 'object') {
      if (key === 'exists') out.add(String(value.field || '').split('.').pop());
      else for (const field of Object.keys(value)) out.add(String(field).split('.').pop());
    } else if (key === 'nested' && value && typeof value === 'object') {
      out.add(String(value.path || '').split('.').pop());
      collectQueryFields(value.query, out);
    } else if (key === 'terms' && value?.field) {
      out.add(String(value.field).split('.').pop());
    } else if (AGG_FUNCTIONS.has(key) && value?.field) {
      out.add(String(value.field).split('.').pop());
    } else if (QUERY_CONTAINERS.has(key)) {
      collectQueryFields(value, out);
    } else if (value && typeof value === 'object') {
      // Alias maps (e.g. named sub-aggregations) put functions behind an
      // arbitrary key; traverse instead of guessing naming conventions.
      collectQueryFields(value, out);
    }
  }
}

export function fieldsFromCalls(calls = []) {
  const fields = new Set();
  for (const call of calls) {
    if (call.tool === 'SearchIndexTool') {
      collectQueryFields(call.args?.query, fields);
      for (const name of call.args?._source || []) fields.add(String(name).split('.').pop());
      for (const entry of call.args?.sort || []) for (const name of Object.keys(entry)) fields.add(String(name).split('.').pop());
      collectQueryFields(call.args?.aggs, fields);
    } else if (call.tool === PPL_TOOL_NAME) {
      const query = String(call.args?.query || '');
      for (const match of query.matchAll(/\bwhere\s+`?([A-Za-z_@][\w.]*)`?/g)) fields.add(match[1].split('.').pop());
      for (const match of query.matchAll(/\bby\s+`?([A-Za-z_@][\w.]*)`?/g)) fields.add(match[1].split('.').pop());
    }
  }
  return [...fields].sort();
}

// ---------------------------------------------------------------------------
// Baseline: the plain tool loop (mirrors runAgent's non-graph path)
// ---------------------------------------------------------------------------

export async function runPlainLoop({ question, conversation = [], model, session, pplExecute, config = {}, maxTurns = 8 }) {
  const messages = [...conversation.map(message => ({ role: message.role, content: message.content })),
    { role: 'user', content: question }];
  for (let turn = 0; turn < maxTurns; turn++) {
    const stream = await model.chat.completions.create({ model: 'mock', messages, stream: true });
    const toolCalls = [];
    let answerText = '';
    for await (const part of stream) {
      const delta = part?.choices?.[0]?.delta || {};
      if (delta.content) answerText += delta.content;
      for (const call of delta.tool_calls || []) toolCalls.push(call);
    }
    if (!toolCalls.length) return { answerText, turns: turn + 1, loopBound: false };
    for (const call of toolCalls) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* keep {} */ }
      const result = call.function?.name === PPL_TOOL_NAME
        ? await pplExecute(config, args, {})
        : await session.callTool(call.function?.name, args, { stage: 'tools/call', readOnly: true });
      messages.push({ role: 'assistant', tool_calls: [{ id: call.id, function: { name: call.function?.name, arguments: call.function?.arguments } }] });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result?.content?.[0]?.text ?? '' });
    }
  }
  return { answerText: '', turns: maxTurns, loopBound: true };
}

// ---------------------------------------------------------------------------
// Case execution
// ---------------------------------------------------------------------------

function instrumentedSession(mcp, calls) {
  return { callTool: async (name, args) => { calls.push({ tool: name, args }); return mcp.callTool({ name, arguments: args }); } };
}

function instrumentedPpl(set, calls) {
  return async (config, args) => {
    calls.push({ tool: PPL_TOOL_NAME, args });
    return executePplFixture(set, args?.query);
  };
}

export function derivePlanSource(planAttempts = []) {
  const templates = planAttempts.filter(attempt => attempt.kind === 'template');
  const models = planAttempts.filter(attempt => attempt.kind === 'model');
  if (models.some(attempt => attempt.ok)) return 'model';
  if (templates.length && templates.every(attempt => attempt.ok)) return 'template';
  return null;
}

export async function runGraphCase(kase, { catalog, prompts, set }) {
  const mcp = createFixtureMcpClient({ set });
  const calls = [];
  const session = instrumentedSession(mcp, calls);
  const pplExecute = instrumentedPpl(set, calls);
  const ai = createGraphModel({});
  const events = [];
  const started = Date.now();
  const record = await runGraphPipeline({
    question: kase.question, conversation: kase.conversation || [], catalog,
    session, pplExecute, config: { model: 'mock' }, ai, model: 'mock', prompts,
    searchSchema: SEARCH_TOOL_SCHEMA, emit: event => events.push(event),
    now: kase.now ?? FIXED_NOW, retrievedAt: kase.retrievedAt || FIXED_RETRIEVED_AT, dedupe: new Map(),
  });
  let answerText = record.answerText;
  let plainTurns = 0;
  if (record.decision === 'fallback') {
    // The plain loop takes over exactly as the deployed agent would.
    const plain = await runPlainLoop({ question: kase.question, conversation: kase.conversation || [],
      model: createLegacyModel({ set }), session, pplExecute });
    answerText = plain.answerText;
    plainTurns = plain.turns;
  }
  return {
    decision: record.decision, routeId: record.routeId, intent: record.intent,
    params: record.params || {}, paramSources: record.paramSources || {},
    routeAttempts: record.attempts || [], planAttempts: record.planAttempts || [],
    planSource: record.decision === 'answer' ? derivePlanSource(record.planAttempts) : null,
    evidenceStatus: record.evidenceStatus, outcomes: record.outcomes || [],
    answerText, calls, toolCallCount: calls.length, events, plainTurns,
    wallClockMs: Date.now() - started,
  };
}

export async function runBaselineCase(kase, { set }) {
  const mcp = createFixtureMcpClient({ set });
  const calls = [];
  const session = instrumentedSession(mcp, calls);
  const pplExecute = instrumentedPpl(set, calls);
  const started = Date.now();
  const plain = await runPlainLoop({ question: kase.question, conversation: kase.conversation || [],
    model: createLegacyModel({ set }), session, pplExecute });
  return {
    decision: 'unevaluable', routeId: 'unevaluable', intent: 'unevaluable',
    params: {}, paramSources: {}, routeAttempts: [], planAttempts: [], planSource: 'unevaluable',
    evidenceStatus: 'unevaluable', outcomes: [],
    answerText: plain.answerText, calls, toolCallCount: calls.length, events: [], plainTurns: plain.turns,
    wallClockMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Answer grading (identical checks for both workflows)
// ---------------------------------------------------------------------------

export function evaluateAnswer(answerText, spec = {}) {
  const text = String(answerText || '');
  const lower = text.toLowerCase();
  const passed = [], failed = [];
  const recordCheck = (name, pass, detail) => (pass ? passed : failed).push({ name, detail });
  for (const needle of spec.contains || []) recordCheck(`contains:${needle}`, lower.includes(String(needle).toLowerCase()), text.slice(0, 200));
  for (const needle of spec.notContains || []) recordCheck(`notContains:${needle}`, !lower.includes(String(needle).toLowerCase()), text.slice(0, 200));
  for (const needle of spec.cites || []) recordCheck(`cites:${needle}`, lower.includes(String(needle).toLowerCase()), text.slice(0, 200));
  if (spec.statesTimeScope !== undefined) recordCheck('statesTimeScope', /\btime scope of the data used\b/i.test(text) === spec.statesTimeScope, text.slice(0, 200));
  if (spec.reportsMissingDetail !== undefined) recordCheck('reportsMissingDetail', /per-test details are (missing|not)|only aggregate counts/i.test(text) === spec.reportsMissingDetail, text.slice(0, 200));
  if (spec.reportsFailedQuery !== undefined) recordCheck('reportsFailedQuery', /quer\w* failed|failed quer|query failure/i.test(text) === spec.reportsFailedQuery, text.slice(0, 200));
  if (spec.reportsIncompleteCoverage !== undefined) recordCheck('reportsIncompleteCoverage', /incomplete coverage|coverage is incomplete/i.test(text) === spec.reportsIncompleteCoverage, text.slice(0, 200));
  if (spec.asksClarification !== undefined) recordCheck('asksClarification', /\?\s*$/.test(text.trim()) === spec.asksClarification, text.slice(0, 200));
  if (spec.abstains !== undefined) recordCheck('abstains', /can't answer|cannot answer|missing evidence|don't have (the )?data/i.test(text) === spec.abstains, text.slice(0, 200));
  return { pass: failed.length === 0, passed, failed };
}

// ---------------------------------------------------------------------------
// Case grading
// ---------------------------------------------------------------------------

export function evaluateCase(kase, outcome, { mode }) {
  const expect = kase.expect || {};
  const graph = mode === 'graph';
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });

  if (graph) {
    if (expect.decision) add('decision', outcome.decision === expect.decision, `got ${outcome.decision}`);
    if (expect.routeId !== undefined && expect.routeId !== 'unevaluable') add('route', outcome.routeId === expect.routeId, `got ${outcome.routeId}`);
    if (expect.intent) add('intent', outcome.intent === expect.intent, `got ${outcome.intent}`);
    for (const [name, value] of Object.entries(expect.params || {})) {
      add(`param:${name}`, outcome.params[name] === value, `got ${JSON.stringify(outcome.params[name])}`);
    }
    for (const [name, value] of Object.entries(expect.paramSources || {})) {
      add(`paramSource:${name}`, outcome.paramSources[name] === value, `got ${outcome.paramSources[name]}`);
    }
    if (expect.evidenceStatus) add('evidenceStatus', outcome.evidenceStatus === expect.evidenceStatus, `got ${outcome.evidenceStatus}`);
    if (expect.planSource) add('planSource', outcome.planSource === expect.planSource, `got ${outcome.planSource}`);
    if (expect.usedPpl !== undefined) add('usedPpl', outcome.calls.some(call => call.tool === PPL_TOOL_NAME) === expect.usedPpl, 'PPL usage');
    if (expect.decision === 'answer') add('validPlan', Boolean(outcome.planSource), `plan source ${outcome.planSource}`);
  }

  const usedFields = fieldsFromCalls(outcome.calls);
  let fieldAccuracy = 'unevaluable';
  if (expect.fields?.length) {
    const matched = expect.fields.filter(name => usedFields.includes(name));
    fieldAccuracy = matched.length / expect.fields.length;
    add('fields', fieldAccuracy === 1, `expected ${expect.fields.join(',')} | used ${usedFields.join(',') || '(none)'}`);
  }

  const answer = evaluateAnswer(outcome.answerText, expect.answer || {});
  checks.push(...answer.passed.map(entry => ({ ...entry, name: `answer:${entry.name}`, pass: true })));
  checks.push(...answer.failed.map(entry => ({ ...entry, name: `answer:${entry.name}`, pass: false })));

  if (expect.maxToolCalls !== undefined) add('toolCallsBounded', outcome.toolCallCount <= expect.maxToolCalls, `got ${outcome.toolCallCount}, max ${expect.maxToolCalls}`);

  const wantsAbstention = expect.answer?.abstains !== undefined || expect.answer?.asksClarification !== undefined;
  const abstentionCorrect = wantsAbstention
    ? answer.failed.every(entry => !['abstains', 'asksClarification'].includes(entry.name))
    : 'unevaluable';

  return {
    caseId: kase.id, mode, notes: kase.notes || null,
    checks, pass: checks.every(check => check.pass),
    metrics: {
      routeFirstAttempt: graph ? (expect.routeId !== undefined && outcome.routeId === expect.routeId) : 'unevaluable',
      routeUsedFallback: graph ? (outcome.routeAttempts?.length > 1) : 'unevaluable',
      fieldAccuracy,
      validPlan: graph ? (expect.decision === 'answer' ? Boolean(outcome.planSource) : 'unevaluable') : 'unevaluable',
      answerCorrect: answer.pass,
      abstentionCorrect,
      toolCalls: outcome.toolCallCount,
      latencyMs: outcome.wallClockMs,
      latencyLabel: LATENCY_LABEL,
    },
  };
}

// ---------------------------------------------------------------------------
// Suite execution
// ---------------------------------------------------------------------------

export async function loadCaseCatalog(kase) {
  const set = await loadFixtureSet(kase.set);
  const base = await loadFixtureCatalog(kase.set); // raw v1 contract + per-set overrides
  const patched = kase.patch ? kase.patch(JSON.parse(JSON.stringify(base))) : base;
  return { set, parsed: parseCatalog(patched, { source: `fixture:${kase.set}` }) };
}

export async function runCase(kase, { mode, prompts }) {
  const { set, parsed } = await loadCaseCatalog(kase);
  if (!parsed.ok) {
    return { caseId: kase.id, mode, error: `catalog invalid: ${parsed.errors.join('; ')}`, checks: [], pass: false, metrics: {} };
  }
  const outcome = mode === 'graph'
    ? await runGraphCase(kase, { catalog: parsed.catalog, prompts, set })
    : await runBaselineCase(kase, { set });
  const graded = evaluateCase(kase, outcome, { mode });
  return {
    ...graded,
    trace: {
      question: kase.question, set: kase.set,
      decision: outcome.decision, routeId: outcome.routeId, intent: outcome.intent,
      params: outcome.params, paramSources: outcome.paramSources,
      routeAttempts: outcome.routeAttempts, planAttempts: outcome.planAttempts, planSource: outcome.planSource,
      evidenceStatus: outcome.evidenceStatus, outcomes: outcome.outcomes,
      toolCalls: outcome.calls, fieldsUsed: fieldsFromCalls(outcome.calls),
      answerText: outcome.answerText,
      wallClockMs: outcome.wallClockMs, latencyLabel: LATENCY_LABEL,
      events: outcome.events.map(event => event.type),
    },
  };
}

function aggregate(results) {
  const byMode = {};
  for (const result of results) {
    const stats = byMode[result.mode] ||= { cases: 0, passed: 0, routeFirstAttempt: [], fieldAccuracy: [], validPlan: [], answerCorrect: 0, abstentionCorrect: [], toolCalls: 0, latencyMs: 0 };
    stats.cases += 1;
    if (result.pass) stats.passed += 1;
    const metrics = result.metrics || {};
    if (metrics.routeFirstAttempt !== 'unevaluable') stats.routeFirstAttempt.push(metrics.routeFirstAttempt);
    if (metrics.fieldAccuracy !== 'unevaluable') stats.fieldAccuracy.push(metrics.fieldAccuracy);
    if (metrics.validPlan !== 'unevaluable') stats.validPlan.push(metrics.validPlan);
    if (metrics.answerCorrect) stats.answerCorrect += 1;
    if (metrics.abstentionCorrect !== 'unevaluable') stats.abstentionCorrect.push(metrics.abstentionCorrect);
    stats.toolCalls += metrics.toolCalls || 0;
    stats.latencyMs += metrics.latencyMs || 0;
  }
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const rate = values => values.length ? values.filter(Boolean).length / values.length : null;
  return Object.fromEntries(Object.entries(byMode).map(([mode, stats]) => [mode, {
    cases: stats.cases, casesPassed: stats.passed,
    routeFirstAttemptAccuracy: rate(stats.routeFirstAttempt),
    fieldAccuracy: mean(stats.fieldAccuracy),
    validPlanRate: rate(stats.validPlan),
    answerCorrectRate: stats.cases ? stats.answerCorrect / stats.cases : null,
    abstentionCorrectRate: rate(stats.abstentionCorrect),
    avgToolCalls: stats.cases ? stats.toolCalls / stats.cases : null,
    avgLatencyMs: stats.cases ? stats.latencyMs / stats.cases : null,
    latencyLabel: LATENCY_LABEL,
  }]));
}

export async function runSuite(cases, { modes = ['graph', 'baseline'], prompts } = {}) {
  const bundle = prompts || await loadPromptBundle('v1');
  const results = [];
  for (const kase of cases) {
    for (const mode of modes) {
      results.push(await runCase(kase, { mode, prompts: bundle }));
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    latencyLabel: LATENCY_LABEL,
    modes,
    summary: aggregate(results),
    results,
  };
}

// ---------------------------------------------------------------------------
// Real-catalog structural replay (offline: routing + plan validation only,
// no query execution — the real indices are not touched)
// ---------------------------------------------------------------------------

export async function runStructuralCase(kase, { catalog, prompts }) {
  const routing = routeQuestion({ question: kase.question, conversation: kase.conversation || [], catalog });
  let planned = null;
  if (routing.decision === 'answer') {
    planned = await planQueries({ question: kase.question, routing, catalog, params: routing.params,
      ai: createGraphModel({}), model: 'mock', prompts, searchSchema: SEARCH_TOOL_SCHEMA });
  }
  const knownRoutes = new Set(catalog.routes.map(route => route.routeId));
  const routeOk = kase.expect?.routeId && knownRoutes.has(kase.expect.routeId)
    ? routing.routeId === kase.expect.routeId
    : null; // route ids differ across catalogs: intent-level check applies
  return {
    caseId: kase.id,
    question: kase.question,
    intent: routing.intent,
    decision: routing.decision,
    routeId: routing.routeId,
    routeMatches: routeOk,
    intentMatches: kase.expect?.intent ? routing.intent === kase.expect.intent : null,
    decisionMatches: kase.expect?.decision ? routing.decision === kase.expect.decision : null,
    planAttempts: planned ? planned.attempts : [],
    planValid: routing.decision === 'answer' ? Boolean(planned?.plans?.length) : null,
    clarification: routing.clarification || null,
    unsupported: routing.unsupported || null,
  };
}
