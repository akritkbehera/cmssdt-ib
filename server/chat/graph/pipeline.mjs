// Graph-guided investigation pipeline: ROUTE → QUERY → ANSWER.
//
// Runs inside the normal chatbot entry point when a versioned catalog is
// configured (CHAT_GRAPH_PATH). Planning prompts and answer prompts come from
// the versioned prompt modules; execution goes through the existing read-only
// MCP/PPL paths with the requesting user's credentials. Questions the catalog
// cannot route fall back to the plain tool loop instead of dead-ending.
import { routeQuestion, wantsPerTestDetail } from '../skills/route.mjs';
import { compileTemplate, compilePlan, executeQueries, combineResults, describeScope, QUERY_LIMITS } from '../skills/query.mjs';
import { buildEvidenceBundle, renderEvidence } from '../skills/answer.mjs';
import { renderRetrieval } from './retrieval.mjs';
import { loadPromptBundle } from '../skills/prompts.mjs';
import { nullDiagnostics, sanitizeSecrets } from '../diagnostics.mjs';

// One non-streaming JSON model call (Kimi via the CERN AI Gateway adapter the
// chatbot already uses). Returns a parsed object or null — callers treat an
// unparseable reply as a failed attempt, not as data.
export async function callModelJson(ai, { model, messages, signal, maxTokens = 900 }) {
  const completion = await ai.chat.completions.create({ model, messages, stream: false,
    max_tokens: maxTokens, temperature: 0 }, { signal });
  const text = completion?.choices?.[0]?.message?.content ?? '';
  const block = /\{[\s\S]*\}/.exec(String(text));
  if (!block) return null;
  try { return JSON.parse(block[0]); } catch { return null; }
}

async function streamFinalAnswer(ai, { model, system, user, signal, emit }) {
  const stream = await ai.chat.completions.create({ model, messages: [
    { role: 'system', content: system }, { role: 'user', content: user } ], stream: true, max_tokens: 2048 }, { signal });
  let text = '';
  for await (const part of stream) {
    const delta = part?.choices?.[0]?.delta?.content;
    if (delta) { text += delta; emit?.({ type: 'text', text: delta }); }
  }
  return text;
}

// Produce the plan for one route: validated templates first (one bounded
// query per scoped dataset for multi-dataset routes), then a Kimi structured
// plan validated and compiled in code (bounded attempts).
export async function planQueries({ question, routing, catalog, params, ai, model, prompts, searchSchema, signal, diagnostics = nullDiagnostics, now = Date.now() }) {
  const bundle = routing.bundle;
  const attempts = [];
  const compiledTemplates = bundle.templates.map(template => {
    const compiled = compileTemplate(template, { params, catalog, routeId: routing.routeId, now });
    attempts.push({ kind: 'template', templateId: template.templateId, ok: compiled.ok,
      errors: compiled.errors.map(error => error.code) });
    return compiled;
  });
  if (compiledTemplates.length && compiledTemplates.every(compiled => compiled.ok)) {
    return { plans: compiledTemplates.map(compiled => ({ ir: compiled.ir, templateId: compiled.ir.templateId, source: 'template' })), attempts };
  }
  if (!ai || !model) return { plans: [], attempts, reason: 'no validated template and no model available for planning' };

  const retrievalText = renderRetrieval(bundle);
  for (let attempt = 1; attempt <= QUERY_LIMITS.attempts; attempt++) {
    const user = prompts.query.render({ question, retrievalText, params });
    const feedback = attempts.filter(entry => entry.kind === 'model' && entry.errors?.length)
      .map(entry => `previous plan rejected: ${entry.errors.join('; ')}`).join('\n');
    const plan = await callModelJson(ai, { model, signal, messages: [
      { role: 'system', content: prompts.query.system },
      { role: 'user', content: feedback ? `${user}\n\n${feedback}` : user },
    ] }).catch(() => null);
    if (!plan) { attempts.push({ kind: 'model', ok: false, errors: ['unparseable_plan'] }); continue; }
    const compiled = compilePlan(plan, { catalog, retrieval: bundle, routeId: routing.routeId });
    attempts.push({ kind: 'model', ok: compiled.ok, errors: compiled.errors.map(error => error.code), dataset: plan.dataset_id || null });
    if (compiled.ok) return { plans: [{ ir: compiled.ir, templateId: null, source: 'model' }], attempts };
    if (diagnostics?.log) diagnostics.log('plan_rejected', { stage: 'plan', attempt, errors: compiled.errors.map(error => error.code) });
  }
  return { plans: [], attempts, reason: 'no plan passed validation' };
}

// Full pipeline for one question. Returns a structured record (also used by
// the replay evaluation) and streams the final answer through `emit`.
export async function runGraphPipeline({ question, conversation = [], catalog, session, pplExecute, config, ai, model,
  prompts, searchSchema, emit, signal, diagnostics = nullDiagnostics, registry = null, dedupe = null, retrievedAt = null, now = Date.now() }) {
  const started = Date.now();
  const routing = routeQuestion({ question, conversation, catalog });
  const record = {
    question, intent: routing.intent, routeId: routing.routeId, decision: routing.decision,
    params: routing.params, paramSources: routing.sources, attempts: routing.attempts || [],
    planAttempts: [], toolCalls: 0, outcomes: [], evidenceStatus: null, answerText: '', durationMs: 0,
  };
  // Unrelated/free-form questions are not a graph concern: return control to
  // the plain tool loop so existing behavior is preserved.
  if (routing.intent === 'generic' && routing.decision === 'unsupported') {
    record.decision = 'fallback';
    record.durationMs = Date.now() - started;
    return record;
  }

  if (routing.decision === 'clarify') {
    record.answerText = routing.clarification.question;
    emit?.({ type: 'text', text: routing.clarification.question });
    emit?.({ type: 'done' });
    record.durationMs = Date.now() - started;
    return record;
  }
  if (routing.decision === 'unsupported') {
    const text = `I can't answer this from the knowledge graph yet.\n\n${routing.unsupported.detail}\n\nMissing evidence or capability:\n${routing.unsupported.needs.map(item => `- ${item}`).join('\n')}`;
    record.answerText = text;
    emit?.({ type: 'text', text });
    emit?.({ type: 'done' });
    record.durationMs = Date.now() - started;
    return record;
  }

  emit?.({ type: 'activity', text: `Routing → ${routing.routeId}…` });
  const planned = await planQueries({ question, routing, catalog, params: routing.params, ai, model, prompts, searchSchema, signal, diagnostics, now });
  record.planAttempts = planned.attempts;
  if (!planned.plans.length) {
    const text = `I routed the question to '${routing.routeId}' but no query plan passed validation (${planned.reason || 'unknown reason'}), so I have no verified results to answer from.\nPlan validation details: ${JSON.stringify(planned.attempts)}`;
    record.answerText = text;
    record.evidenceStatus = 'query_failed';
    emit?.({ type: 'text', text });
    emit?.({ type: 'done' });
    record.durationMs = Date.now() - started;
    return record;
  }

  emit?.({ type: 'activity', text: `Querying ${planned.plans[0].ir.datasetId}…` });
  const results = await executeQueries({ plans: planned.plans, session, pplExecute, config, searchSchema,
    signal, diagnostics, registry, dedupe });
  record.toolCalls = results.reduce((sum, result) => sum + (result.attempts || 1), 0);
  record.outcomes = results.map(result => ({ dataset: result.plan?.ir?.datasetId || null, outcome: result.outcome, attempts: result.attempts || 1 }));

  const joins = routing.bundle.joins || [];
  const combined = results.length > 1 ? combineResults(results, joins, { granularity: routing.bundle.route?.granularity }) : null;
  const needsPerTestDetail = wantsPerTestDetail(question);
  // The route's first template carries the records the question asks about;
  // remaining templates are context (e.g. build metadata).
  const primaryTemplate = routing.bundle.templates?.[0] || null;
  const primaryDatasetIds = primaryTemplate ? new Set([primaryTemplate.datasetId]) : null;
  const bundle = buildEvidenceBundle({ question, routing, results, combined, catalog,
    retrievedAt: retrievedAt || new Date().toISOString(), needsPerTestDetail, primaryDatasetIds });
  record.evidenceStatus = bundle.completeness.status;
  record.evidenceScope = describeScope(results.map(result => ({ ir: result.plan.ir })), routing.params);

  const evidenceText = renderEvidence(bundle);
  const system = prompts.answer.system;
  const user = prompts.answer.render({ question, evidenceText });
  if (ai && model) {
    record.answerText = await streamFinalAnswer(ai, { model, system, user, signal, emit })
      .catch(error => { throw error; });
  } else {
    // Deterministic fallback rendering when no model is attached (offline
    // tooling): evidence status first, then bounded rows/aggregates.
    record.answerText = `${bundle.completeness.status}: ${bundle.completeness.details.join('; ')}`;
    emit?.({ type: 'text', text: record.answerText });
  }
  emit?.({ type: 'done' });
  record.durationMs = Date.now() - started;
  record.evidence = bundle;
  return record;
}

// Load a catalog for the runtime entry point. Fails closed: no graph means the
// plain loop keeps working.
export async function loadGraph(path, { loadCatalog } = {}) {
  const loader = loadCatalog || (await import('./catalog.mjs')).loadCatalog;
  const loaded = await loader(path);
  return { ok: loaded.ok, source: loaded.source, errors: loaded.errors, warnings: loaded.warnings,
    catalog: loaded.ok ? loaded.catalog : null, loadedAt: new Date().toISOString() };
}
