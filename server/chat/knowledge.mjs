// Verified-knowledge loader and warm-up for the IB Insights agent.
//
// Structural knowledge (schema-registry.json, query-templates.json, context.md)
// is a static, verified snapshot of a 2026-11-17 discovery session. It contains
// no user data and is safe to share process-wide. Operational values (latest
// releases, counts) are NEVER part of the static files: they are fetched live
// through the caller's own MCP client (per-user authorization preserved) and
// cached per principal with a short TTL, clearly labelled as query results.
//
// The raw discovery files under opensearch-discovery/raw/ are provenance only.
// This module never reads them and nothing serves them to end users.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KNOWLEDGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'knowledge');
export const SNAPSHOT_DATE = '2026-11-17';
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

const loaded = new Map(); // dir -> Promise<knowledge>

export async function loadKnowledge(dir = KNOWLEDGE_DIR) {
  if (!loaded.has(dir)) loaded.set(dir, readKnowledge(dir).catch(error => ({
    ok: false, dir, error: error.message, context: '', registry: null, templates: null, fieldIndex: new Set(),
  })));
  return loaded.get(dir);
}

async function readKnowledge(dir) {
  const [context, registryText, templatesText] = await Promise.all([
    readFile(path.join(dir, 'context.md'), 'utf8'),
    readFile(path.join(dir, 'schema-registry.json'), 'utf8'),
    readFile(path.join(dir, 'query-templates.json'), 'utf8'),
  ]);
  const registry = JSON.parse(registryText);
  const templates = JSON.parse(templatesText);
  const fieldIndex = new Set(Object.keys(registry.fields || {}));
  for (const [group, value] of Object.entries(registry.metric_field_groups || {})) {
    if (Array.isArray(value)) for (const field of value) fieldIndex.add(field);
    if (group === 'memory_probe_pattern') for (const name of value.names || []) {
      for (const suffix of ['a-COUNT', 'b-RUN', 'c-EVENT', 'd-VSIZE', 'e-DELTV', 'f-RSS']) fieldIndex.add(`${name}-${suffix}`);
    }
  }
  return { ok: true, dir, context, registry, templates, fieldIndex };
}

/** True only for fields that appear in the verified registry. Used to reject
 *  invented field names before any query leaves the server. */
export function isKnownField(knowledge, field) {
  return Boolean(knowledge?.fieldIndex?.has(field) || field === '@timestamp' || field === '_index');
}

// ---------------------------------------------------------------------------
// Template rendering / argument validation
// ---------------------------------------------------------------------------

const PATTERN = {
  release: /^CMSSW_[0-9]+_[0-9]+(_[A-Z0-9]+)?_X_[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}$/,
  cycle: /^CMSSW_[0-9]+_[0-9]+(_[A-Z0-9]+)?_X$/,
  architecture: /^[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/,
  workflow: /^[0-9]+\.[0-9]+$/,
};

export function findTemplate(knowledge, id) {
  return knowledge?.templates?.templates?.find(template => template.id === id) || null;
}

/** Validate caller arguments against the template's declared parameter types
 *  and the registry's field types. Unknown arguments and unknown fields are
 *  rejected; nothing is invented. */
export function validateTemplateArgs(knowledge, templateId, args = {}) {
  const template = findTemplate(knowledge, templateId);
  if (!template) return { ok: false, errors: [`Unknown query template '${templateId}'.`] };
  // A template's parameters are exactly the ones it declares. A declared
  // `type` may name an entry of the global param_types table, which then
  // supplies the concrete type, pattern and bound field. The global table is
  // a type catalogue, never a list of required arguments.
  const paramTypes = knowledge.templates.param_types || {};
  const declared = {};
  for (const [name, spec] of Object.entries(template.params || {})) {
    const ref = paramTypes[spec.type];
    declared[name] = ref ? { ...ref, ...spec, type: ref.type } : { ...spec };
  }
  const errors = [];
  const values = {};
  for (const name of Object.keys(args)) {
    if (!declared[name]) errors.push(`Unknown argument '${name}' for template '${templateId}'.`);
  }
  for (const [name, spec] of Object.entries(declared)) {
    let value = args[name];
    if (value === undefined || value === null || value === '') {
      if (spec.optional || spec.default !== undefined) { if (spec.default !== undefined) values[name] = spec.default; continue; }
      errors.push(`Missing required argument '${name}' for template '${templateId}'.`);
      continue;
    }
    const type = spec.type;
    if (type === 'integer') {
      value = Number(value);
      if (!Number.isInteger(value)) { errors.push(`Argument '${name}' must be an integer.`); continue; }
      if (spec.min !== undefined && value < spec.min) errors.push(`Argument '${name}' must be >= ${spec.min}.`);
      if (spec.max !== undefined && value > spec.max) errors.push(`Argument '${name}' must be <= ${spec.max}.`);
    } else if (typeof value !== 'string') {
      errors.push(`Argument '${name}' must be a string.`);
      continue;
    } else {
      const pattern = PATTERN[type] || (spec.pattern ? new RegExp(spec.pattern) : null);
      if (pattern && !pattern.test(value)) errors.push(`Argument '${name}' does not match the ${type} format.`);
    }
    // Every declared parameter must map onto a registry field, or be a pure
    // query-control parameter. This is the "no invented fields" gate.
    if (spec.field && !isKnownField(knowledge, spec.field)) errors.push(`Template parameter '${name}' targets unknown field '${spec.field}'.`);
    values[name] = value;
  }
  return errors.length ? { ok: false, errors } : { ok: true, template, values };
}

/** Render a template body: substitute ${param} placeholders and drop filter
 *  clauses whose optional parameter was not supplied. */
export function renderTemplate(knowledge, templateId, args = {}) {
  const check = validateTemplateArgs(knowledge, templateId, args);
  if (!check.ok) return check;
  const values = check.values;
  const walk = node => {
    if (Array.isArray(node)) {
      const out = [];
      for (const item of node) { const value = walk(item); if (value !== undefined) out.push(value); }
      return out;
    }
    if (node && typeof node === 'object') {
      const out = {};
      let dropped = false;
      for (const [key, item] of Object.entries(node)) {
        const value = walk(item);
        if (value === undefined) { dropped = true; continue; }
        out[key] = value;
      }
      if (dropped && !Object.keys(out).length) return undefined; // whole clause dropped
      return out;
    }
    if (typeof node === 'string') {
      const match = /^\$\{(\w+)\}$/.exec(node);
      if (!match) return node;
      return values[match[1]];
    }
    return node;
  };
  return { ok: true, template: check.template, body: walk(check.template.body), values };
}

// ---------------------------------------------------------------------------
// Relevance selection (inject only what the question needs)
// ---------------------------------------------------------------------------

const FAMILY_HINTS = [
  { family: 'cmssdt-ib-matrix', words: ['matrix', 'relval', 'relvals', 'workflow', 'step', 'exit code', 'exitcode', 'failure', 'failed', 'ib ', 'ib?', 'ib.', 'architecture', 'release', 'build log'] },
  { family: 'cmssdt-ibs', words: ['ib summary', 'build status', 'unit test', 'unit-test', 'unittest'] },
  { family: 'cmssdt-jenkins-jobs', words: ['jenkins', 'job', 'queue', 'node'] },
  { family: 'cmssdt-externals_stats_summary', words: ['external', 'externals'] },
  { family: 'cmssdt-cmssw-pkginfo', words: ['package info', 'pkginfo'] },
];
const TEMPLATE_HINTS = [
  { id: 'latest_release_for_cycle', words: ['latest', 'newest', 'most recent', 'current', 'today'] },
  { id: 'release_doc_counts', words: ['latest', 'newest', 'release list', 'which ib', 'how many'] },
  { id: 'failed_steps', words: ['failed', 'failure', 'failing', 'broke', 'error'] },
  { id: 'failure_distribution_by_arch', words: ['which architecture', 'architectures have', 'per architecture', 'per arch', 'compare'] },
  { id: 'architecture_list', words: ['which architecture', 'architectures are', 'arch list'] },
  { id: 'exception_docs', words: ['exception', 'stacktrace', 'crash'] },
  { id: 'exitcode_distribution', words: ['exit code', 'exitcode', 'distribution'] },
  { id: 'release_sample', words: ['compare', 'show me', 'sample', 'documents'] },
];
const METRIC_WORDS = ['time', 'timing', 'cpu', 'memory', 'rss', 'vsize', 'throughput', 'event time', 'peak', 'heap', 'growth rate'];

export function selectKnowledge(knowledge, question = '', { budget = 4000 } = {}) {
  const text = String(question || '').toLowerCase();
  const registry = knowledge?.registry;
  if (!knowledge?.ok || !registry) {
    return {
      ok: false, needsDiscovery: true, families: [], templates: [],
      text: 'Verified schema knowledge could not be loaded. Discover indices with ListIndexTool and inspect mappings with IndexMappingTool before writing any query; never assume field names.',
    };
  }
  const families = [];
  for (const hint of FAMILY_HINTS) {
    if (hint.words.some(word => text.includes(word))) {
      const family = registry.index_families.find(item => item.family === hint.family);
      if (family) families.push(family);
    }
  }
  if (!families.length) families.push(registry.index_families.find(item => item.family === 'cmssdt-ib-matrix'));
  const templates = [];
  for (const hint of TEMPLATE_HINTS) {
    if (hint.words.some(word => text.includes(word)) && !templates.includes(hint.id)) templates.push(hint.id);
  }
  const unverified = families.filter(family => !family.documents_verified);
  const wantsMetrics = METRIC_WORDS.some(word => text.includes(word));
  const unitTests = /unit[\s-]?test/.test(text);

  const lines = [];
  lines.push(`VERIFIED STRUCTURAL KNOWLEDGE — OpenSearch snapshot ${SNAPSHOT_DATE} (static schema facts, NOT query results).`);
  lines.push('Index families: ' + families.map(family =>
    `${family.family}-* ${family.documents_verified ? `(documents verified, grain: ${family.doc_grain})` : '(schema UNVERIFIED — run IndexMappingTool on it before querying)'}`).join('; ') + '.');
  if (families.some(family => family.family === 'cmssdt-ib-matrix')) {
    const f = registry.fields;
    lines.push(`cmssdt-ib-matrix fields: ${['release', 'architecture', 'workflow', 'step', 'exitcode', '@timestamp', 'test_type', 'error_count', 'errors', 'exception', 'url', 'hostname']
      .map(name => `${name} (${f[name].queryable_as === 'keyword' || f[name].queryable_as === 'integer' ? f[name].queryable_as : f[name].observed_types.join('/')})`).join(', ')}.`);
    lines.push(`Release names: ${registry.release_naming.grammar}; flavours ${registry.release_naming.flavour_tokens_observed.map(t => t || '(default)').join(', ')}. Latest-of-cycle: filter/aggregate per cycle and take the first key in _key-desc order — lexicographic order across cycles is NOT chronological.`);
    lines.push('Failure = exitcode exists and != 0 (0 = success). errors[] is capped at 10 entries; error_count is the true total. exitcode 0 may still carry errors. Failing steps may have no exception field.');
    lines.push('Counts drift while an IB runs; report the retrieval time. hits.total is capped at 10000/gte — count via aggregations. Keep size <= 100 and exclude "command" from _source.');
  }
  if (wantsMetrics) {
    lines.push('Metric fields (timing/memory) are mostly numeric strings but sometimes JSON numbers (MinEventTime sentinel 1000000 as number; negative TotalInitTime seen) — check types before aggregating.');
  }
  if (unitTests) {
    lines.push('UNIT TESTS: no verified schema exists for unit-test results (see discovery-gaps.md G10). Discover the right family/mapping first; do not guess fields.');
  }
  if (templates.length) {
    lines.push('Known-good query templates for this question (ids in query-templates.json): ' + templates.join(', ') + '.');
  }
  if (unverified.length) {
    lines.push(`Run IndexMappingTool before querying: ${unverified.map(family => family.family).join(', ')} (schema unverified).`);
  }
  let body = lines.join('\n');
  if (body.length > budget) body = `${body.slice(0, budget)}\n[truncated]`;
  return {
    ok: true,
    needsDiscovery: unverified.length > 0 || unitTests,
    families: families.map(family => family.family),
    templates,
    text: body,
  };
}

// ---------------------------------------------------------------------------
// Per-principal operational cache + warm-up
// ---------------------------------------------------------------------------

export function principalOf(runtime = {}) {
  const header = runtime.mcpHeaders?.Authorization || runtime.mcpHeaders?.authorization;
  const secret = header || runtime.mcpTokenFile || runtime.kerberosCache || 'anonymous-service';
  return `u_${createHash('sha256').update(String(secret)).digest('hex').slice(0, 16)}`;
}

export function createKnowledgeCache({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map();
  const counters = { hits: 0, misses: 0, stores: 0, evictions: 0 };
  return {
    ttlMs,
    counters,
    get(key) { return entries.get(key); },
    set(key, value) { counters.stores++; entries.set(key, value); },
    delete(key) { entries.delete(key); },
    clear() { entries.clear(); },
    size() { return entries.size; },
    /** Load a value through the per-principal cache. Missing or stale entries
     *  trigger the loader (a live discovery/query); fresh entries are reused. */
    async fetch(key, { ttl = ttlMs, load, now: at } = {}) {
      const current = (at ?? now)();
      const entry = entries.get(key);
      if (entry && current - entry.fetchedAt < ttl) { counters.hits++; return { value: entry.value, cached: true, fetchedAt: entry.fetchedAt, stale: false }; }
      if (entry) counters.evictions++;
      counters.misses++;
      const value = await load();
      const fetchedAt = (at ?? now)();
      entries.set(key, { value, fetchedAt });
      counters.stores++;
      return { value, cached: false, fetchedAt, stale: Boolean(entry) };
    },
  };
}

export const defaultCache = createKnowledgeCache();

export function needsFreshness(question = '') {
  return /\b(latest|newest|most recent|current|today|now|recent)\b/i.test(String(question || ''));
}

export function detectCycle(question = '') {
  const match = /CMSSW[_\s]?(\d+)[_.\s](\d+)[_.\s]?(ROOT6|UBSAN|ASAN|DBG|HI)?/i.exec(String(question || ''));
  if (!match) return null;
  const flavour = match[3] ? `_${match[3].toUpperCase()}` : '';
  return `CMSSW_${match[1]}_${match[2]}${flavour}_X`;
}

const LATEST_BODY = {
  size: 0,
  aggs: { releases: { terms: { field: 'release', size: 200, order: { '_key': 'desc' } } } },
};

/** Build SearchIndexTool arguments strictly from the tool schema discovered at
 *  runtime — never assume argument names. Returns null when the schema cannot
 *  express this query, in which case the model must verify freshness itself. */
export function buildSearchArgs(searchSchema, { index, body }) {
  const properties = searchSchema?.properties || searchSchema?.schema?.properties || {};
  const args = {};
  if ('index' in properties) args.index = index;
  else if (searchSchema?.required?.includes('index')) args.index = index;
  else return null;
  if ('body' in properties) args.body = body;
  else return null; // no DSL body support: aggregations are impossible
  for (const name of Object.keys(args)) {
    const spec = properties[name];
    if (spec?.type === 'string' && typeof args[name] !== 'string') return null;
    if (spec?.type === 'object' && typeof args[name] === 'string') return null;
  }
  return args;
}

function pickLatest(buckets, cycle) {
  const keys = (buckets || []).map(bucket => bucket.key).filter(Boolean);
  if (cycle) return keys.find(key => key.startsWith(`${cycle}_`)) || null;
  return keys[0] || null; // lexicographic max; only meaningful within one cycle
}

/** Warm-up: inject verified structural knowledge and, when the question needs
 *  current values, one cheap live aggregation through the caller's own MCP
 *  client. Structural text is labelled as a static snapshot; the live result is
 *  labelled as an operational query result with its fetch time, so the model
 *  never confuses the two. */
export async function warmUp({ question = '', mcp, runtime = {}, signal, cache = defaultCache, searchSchema, ttl = cache.ttlMs, now = Date.now, emit } = {}) {
  const knowledge = await loadKnowledge();
  const selection = selectKnowledge(knowledge, question);
  const parts = [];
  const stats = { structural: selection.ok, probes: 0, cacheHits: 0, probeFailures: 0, needsDiscovery: selection.needsDiscovery };
  if (emit) emit({ type: 'activity', text: selection.ok ? 'Applying verified IB schema knowledge…' : 'Schema knowledge unavailable; discovery required.' });
  parts.push(selection.text);

  if (selection.ok && needsFreshness(question) && mcp?.callTool) {
    const principal = principalOf(runtime);
    const cycle = detectCycle(question);
    const key = `${principal}:release-buckets`;
    try {
      const result = await cache.fetch(key, {
        ttl,
        now,
        load: async () => {
          const args = buildSearchArgs(searchSchema, { index: 'cmssdt-ib-matrix-*', body: LATEST_BODY });
          if (!args) return null;
          stats.probes++;
          const raw = await mcp.callTool({ name: 'SearchIndexTool', arguments: args }, undefined, { signal, timeout: 30000 });
          const payload = JSON.parse(raw?.content?.[0]?.text ?? raw?.content?.[0] ?? '{}');
          return (payload?.aggregations?.releases?.buckets || []).map(bucket => ({ key: bucket.key, doc_count: bucket.doc_count }));
        },
      });
      if (result.cached) stats.cacheHits++;
      const buckets = result.value;
      if (buckets) {
        const latest = pickLatest(buckets, cycle);
        const scope = cycle ? cycle : 'all cycles (lexicographic max — filter to one cycle before answering)';
        parts.push(`OPERATIONAL SNAPSHOT — live query result fetched ${new Date(result.fetchedAt).toISOString()} via SearchIndexTool on cmssdt-ib-matrix-* (not structural knowledge; re-verify if older than ${Math.round(ttl / 60000)} min).\nLatest IB for ${scope}: ${latest || 'none found'}. Doc counts drift while an IB runs; treat this as a starting point and confirm with your own tool results.`);
      } else {
        stats.probeFailures++;
        parts.push('OPERATIONAL SNAPSHOT: unavailable (SearchIndexTool schema cannot run the freshness aggregation). Verify latest releases with your own tool calls.');
      }
    } catch {
      stats.probeFailures++;
      parts.push('OPERATIONAL SNAPSHOT: unavailable (freshness probe failed). Verify latest releases with your own tool calls and say so.');
    }
  }
  return { knowledge, selection, systemAddendum: parts.join('\n\n'), stats };
}
