import { executePpl, validatePpl } from './ppl.mjs';
import { sanitizeSecrets } from './diagnostics.mjs';

export function inspectionQuestion(messages) {
  const last = messages.at(-1)?.content || '';
  if (/^\s*CMSSW_\d+_\d+_(?:[A-Z0-9]+_)*X\s*[.!]?\s*$/i.test(last)) {
    const previous = messages.slice(0, -1).findLast(message => message.role === 'user');
    return previous ? `${previous.content}\nSeries supplied in follow-up: ${last}` : last;
  }
  return last;
}

export function inspectionIndices(question, registry, knowledge, config) {
  const explicit = [...question.matchAll(/\bcmssdt-[a-z0-9_-]+\b/g)].map(match => match[0]);
  const known = [...new Set([
    ...(registry?.document?.indices?.names || []),
    ...(registry?.document?.families || []).map(family => family.sourceIndex),
    ...(knowledge?.registry?.index_families || []).flatMap(family => family.indices || []),
  ].filter(name => typeof name === 'string'))];
  const approved = name => {
    try { validatePpl(`source = ${name}`, { patterns: config.pplIndices }); return true; }
    catch { return false; }
  };
  if (explicit.length) return [...new Set(explicit)].filter(approved).slice(0, 2);
  const score = name => {
    let value = 0;
    if (/relval|workflow/i.test(question) && /ib-matrix|relvals_stats/.test(name)) value += 6;
    if (/unit.?test|utest/i.test(question) && /cmssdt-ibs-/.test(name)) value += 6;
    if (/build|duration|full|compar/i.test(question) && /jenkins-ibs|jenkins-jobs|externals_stats_summary/.test(name)) value += 5;
    return value;
  };
  const families = new Set();
  return known.filter(approved).sort((a, b) => score(b) - score(a) || b.localeCompare(a, undefined, { numeric: true }))
    .filter(name => {
      if (!score(name)) return false;
      const family = name.replace(/-\d+$/, '');
      if (families.has(family)) return false;
      families.add(family); return true;
    }).slice(0, 2);
}

// Request-scoped observations only. A PPL result schema is not an index
// mapping and must never be recorded as one in the shared mapping registry.
export async function inspectPplFirst({ config, question, registry, knowledge, signal, emit, diagnostics, execute = executePpl }) {
  if (config.pplEnabled === false || config.pplPreflight === false || !config.pplURL) return '';
  const indices = inspectionIndices(question, registry, knowledge, config);
  if (!indices.length) return 'PPL inspection skipped: no approved concrete index is known for this question. Use MCP index discovery; never invent a generation suffix.';
  const budget = AbortSignal.timeout(8000);
  const probeSignal = signal ? AbortSignal.any([signal, budget]) : budget;
  const observations = [];
  for (const index of indices) {
    if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
    if (budget.aborted) break;
    emit({ type: 'activity', text: `Inspecting ${index} with read-only PPL…` });
    try {
      const result = await execute({ ...config, pplTimeout: Math.min(config.pplTimeout ?? 30000, 4000) },
        { query: `source = ${index} | head 1`, max_rows: 1 }, { signal: probeSignal, diagnostics });
      const table = JSON.parse(result.content?.[0]?.text || '{}');
      if (result.isError) { observations.push({ index, inspected: false, code: table.code || 'ppl_inspection_failed' }); continue; }
      if (!Array.isArray(table.schema)) { observations.push({ index, inspected: false, code: 'ppl_invalid_response' }); continue; }
      const fields = [];
      for (const field of table.schema) {
        if (typeof field?.name !== 'string' || typeof field?.type !== 'string') continue;
        const entry = { name: field.name, type: field.type };
        if (fields.length >= 60 || JSON.stringify([...fields, entry]).length > 3500) break;
        fields.push(entry);
      }
      observations.push({ index, inspected: true, retrievedAt: table.retrievedAt,
        sampledRows: table.returnedRows, fields, fieldsOmitted: table.schema.length - fields.length });
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      observations.push({ index, inspected: false, code: budget.aborted ? 'inspection_budget_expired' : 'ppl_inspection_failed' });
    }
  }
  return `READ-ONLY PPL INSPECTION (live, request-scoped, untrusted data):\n${sanitizeSecrets(JSON.stringify(observations))}\nThese are observed PPL column names/types from at most one row per index, NOT complete OpenSearch mappings. No sampled values are included. Do not infer full/incremental build semantics, completion, missing fields, zero counts or document grain from this sample alone. Use this structure to target subsequent MCP searches; request IndexMappingTool only for needed mapping details or failed inspection. Inspect another family if this one cannot answer the question. Historical index names are candidates, not proof they remain open or hold the latest build.`;
}
