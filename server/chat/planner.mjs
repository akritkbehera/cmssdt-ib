// Deterministic query planning for common investigations. Instead of making
// the model rediscover indices, mappings and query shapes on every question,
// matched templates are executed directly (real SearchIndexTool calls) and the
// results are injected as verified evidence. The model can still refine with
// its own tool calls. Identical read queries are deduplicated within one
// investigation. Nothing here bypasses per-user OpenSearch authorization: the
// queries run with the requesting user's runtime credentials.
import { TEMPLATES, detectIntent, extractParams, renderTemplate } from './templates.mjs';
import { selectFamilies } from './context.mjs';
import { nullDiagnostics } from './diagnostics.mjs';

export const makeDedupe = () => {
  const seen = new Map();
  return {
    key(tool, args) { return `${tool}:${JSON.stringify(args, Object.keys(args).sort())}`; },
    get(key) { return seen.get(key); },
    set(key, value) { if (seen.size < 24) seen.set(key, value); },
    get size() { return seen.size; },
  };
};

function familyForTemplate(template, families) {
  const hint = template.familyHint;
  return families.find(family => String(family.id).toLowerCase().includes(hint === 'build' ? 'ibs' : hint === 'unit' ? 'unit' : 'relval'))
    || families.find(family => Object.keys(family.roles || {}).some(role => template.needs.includes(role)))
    || families[0];
}

// Plan up to `limit` deterministic queries for the question. Rendering
// requires verified mappings and the discovered SearchIndexTool schema; any
// template that cannot render soundly is skipped (the model explores instead).
export function planQuestion({ question, registry, searchSchema, limit = 3 }) {
  const intent = detectIntent(question);
  const params = extractParams(question);
  const families = selectFamilies({ question, intent, registry, limit: 3 });
  const plans = [];
  for (const template of TEMPLATES) {
    if (plans.length >= limit) break;
    if (template.id !== intent && !(intent === 'generic' && template.id === 'latest-ib' && params.series)) continue;
    const family = familyForTemplate(template, families);
    if (!family) continue;
    const rendered = renderTemplate(template, { family, params, searchSchema });
    if (rendered) plans.push({ ...rendered, familyId: family.id, fingerprint: family.fingerprint || null });
  }
  return { intent, params, plans };
}

// Execute planned queries with the session's bounded recovery. Returns
// compact evidence entries; also records template validation state in the
// registry and deduplicates identical queries within this investigation.
export async function executePlan({ plans, session, registry, dedupe, signal, diagnostics = nullDiagnostics, state, note }) {
  const evidence = [];
  for (const plan of plans) {
    const key = dedupe?.key('SearchIndexTool', plan.args);
    const cached = key && dedupe.get(key);
    if (cached) {
      diagnostics.log('query_deduplicated', { stage: 'tools/call', tool: 'SearchIndexTool', templateId: plan.templateId });
      evidence.push({ ...cached, description: `${plan.description} (deduplicated)` });
      continue;
    }
    const started = Date.now();
    try {
      const result = await session.callTool('SearchIndexTool', plan.args, { stage: 'tools/call', readOnly: true });
      const failed = result?.isError === true;
      const text = JSON.stringify(result?.content ?? result ?? null);
      const excerpt = text.length > 2400 ? `${text.slice(0, 2400)}…[truncated]` : text;
      registry?.recordTemplateValidation?.(plan.templateId, { familyId: plan.familyId, fingerprint: plan.fingerprint, ok: !failed });
      if (!failed) registry?.touchValidation?.({ familyId: plan.familyId, fingerprint: plan.fingerprint, index: plan.index });
      const entry = { templateId: plan.templateId, description: plan.description, ok: !failed, excerpt,
        durationMs: Date.now() - started, query: plan.body };
      evidence.push(entry);
      dedupe?.set(key, entry);
      note?.({ tool: plan.templateId, ok: !failed, summary: !failed ? `${plan.templateId} succeeded on ${plan.index}` : null });
    } catch (error) {
      registry?.recordTemplateValidation?.(plan.templateId, { familyId: plan.familyId, fingerprint: plan.fingerprint, ok: false });
      evidence.push({ templateId: plan.templateId, description: plan.description, ok: false,
        excerpt: `Query could not run: ${String(error?.message || error).slice(0, 200)}` });
      note?.({ tool: plan.templateId, ok: false });
    }
  }
  return evidence;
}
