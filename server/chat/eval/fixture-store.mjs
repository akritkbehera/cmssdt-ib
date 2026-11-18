// Deterministic fixture store for offline execution and replay evaluation.
//
// Provides: a small OpenSearch DSL evaluator over fixture documents (term,
// prefix, range, not_term, exists, nested; sort, size, _source, terms
// aggregations), a PPL evaluator for the approved generated grammar, and mock
// MCP/PPL adapters shaped like the production read paths. Per-set error
// configuration reproduces missing/closed/unauthorized indices. No network
// access: every "query" is answered from local fixture JSON. Timing measured
// through these adapters is mocked transport timing.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const SEARCH_TOOL_SCHEMA = {
  type: 'object',
  properties: { index: { type: 'string' }, query: { type: 'object' }, size: { type: 'number' },
    sort: { type: 'array' }, _source: { type: 'array' }, aggs: { type: 'object' } },
  required: ['index'],
};

export const FIXTURE_TOOLS = [
  { name: 'ListIndexTool', description: 'List indices', inputSchema: { type: 'object', properties: {} } },
  { name: 'IndexMappingTool', description: 'Get mapping', inputSchema: { type: 'object', properties: { index: { type: 'string' } }, required: ['index'] } },
  { name: 'SearchIndexTool', description: 'Search', inputSchema: SEARCH_TOOL_SCHEMA },
];

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const cache = new Map();
export async function loadFixtureSet(name = 'full') {
  if (!cache.has(name)) cache.set(name, (async () => {
    const dir = join(FIXTURES_DIR, 'sets', name);
    const data = JSON.parse(await readFile(join(dir, 'data.json'), 'utf8'));
    let errors = {}, overrides = {};
    try { errors = JSON.parse(await readFile(join(dir, 'errors.json'), 'utf8')); } catch { /* optional */ }
    try { overrides = JSON.parse(await readFile(join(dir, 'catalog-overrides.json'), 'utf8')); } catch { /* optional */ }
    return { name, data, errors, overrides };
  })());
  return cache.get(name);
}

export async function loadFixtureCatalog(name = 'full') {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, 'catalog.v1.json'), 'utf8'));
  const set = await loadFixtureSet(name);
  return applyOverrides(raw, set.overrides);
}

// Minimal deterministic override application (per-dataset field updates).
export function applyOverrides(catalog, overrides = {}) {
  if (!overrides || !Object.keys(overrides).length) return catalog;
  const clone = JSON.parse(JSON.stringify(catalog));
  for (const [datasetId, patch] of Object.entries(overrides.datasets || {})) {
    const dataset = clone.datasets.find(entry => entry.dataset_id === datasetId);
    if (dataset) Object.assign(dataset, patch);
  }
  return clone;
}

export function matchIndices(pattern, names) {
  const text = String(pattern);
  if (text.endsWith('*')) {
    const prefix = text.slice(0, -1);
    return names.filter(name => name.startsWith(prefix) && name.length > prefix.length);
  }
  return names.filter(name => name === text);
}

// ---------------------------------------------------------------------------
// DSL evaluation over fixture documents
// ---------------------------------------------------------------------------

const get = (doc, path) => String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);

const compare = (a, b) => {
  if (a === undefined || a === null) return b === undefined || b === null ? 0 : -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

function matchesClause(doc, clause) {
  if (!clause || typeof clause !== 'object') return false;
  if (clause.bool) {
    const must = (clause.bool.filter || clause.bool.must || []).every(inner => matchesClause(doc, inner));
    const mustNot = (clause.bool.must_not || []).every(inner => !matchesClause(doc, inner));
    return must && mustNot;
  }
  if (clause.term) {
    const [[field, value]] = Object.entries(clause.term);
    return compare(get(doc, field), value) === 0;
  }
  if (clause.prefix) {
    const [[field, value]] = Object.entries(clause.prefix);
    return String(get(doc, field) ?? '').startsWith(String(value));
  }
  if (clause.range) {
    const [[field, range]] = Object.entries(clause.range);
    const value = get(doc, field);
    if (value === undefined || value === null) return false;
    if (range.gte !== undefined && compare(value, range.gte) < 0) return false;
    if (range.lte !== undefined && compare(value, range.lte) > 0) return false;
    return true;
  }
  if (clause.exists) return get(doc, clause.exists.field) !== undefined && get(doc, clause.exists.field) !== null;
  if (clause.nested) {
    const children = get(doc, clause.nested.path);
    if (!Array.isArray(children)) return false;
    return children.some(child => matchesClause(child, clause.nested.query || {}));
  }
  return false;
}

function project(doc, source) {
  if (!Array.isArray(source)) return doc;
  return Object.fromEntries(source.map(name => [name.split('.').pop(), get(doc, name)])
    .filter(([, value]) => value !== undefined));
}

function termsAggregation(docs, aggs) {
  const spec = aggs?.groups || Object.values(aggs || {})[0];
  if (!spec?.terms) return undefined;
  const field = spec.terms.field;
  const groups = new Map();
  for (const doc of docs) {
    const key = get(doc, field);
    if (key === undefined || key === null) continue;
    const bucket = groups.get(String(key)) || { key, doc_count: 0, docs: [] };
    bucket.doc_count += 1;
    bucket.docs.push(doc);
    groups.set(String(key), bucket);
  }
  const buckets = [...groups.values()].sort((a, b) => b.doc_count - a.doc_count || compare(a.key, b.key))
    .slice(0, spec.terms.size || 10);
  for (const bucket of buckets) {
    delete bucket.docs;
  }
  // sub-aggregations (min/max/sum/avg over one field)
  for (const bucket of buckets) {
    const members = docs.filter(doc => String(get(doc, field)) === String(bucket.key));
    for (const [name, sub] of Object.entries(spec.aggs || {})) {
      const fn = Object.keys(sub)[0];
      const subField = sub[fn]?.field;
      const values = members.map(doc => get(doc, subField)).filter(value => typeof value === 'number' || typeof value === 'string');
      if (!values.length) { bucket[name] = null; continue; }
      if (fn === 'max') bucket[name] = { value: values.reduce((a, b) => (compare(a, b) >= 0 ? a : b)) };
      else if (fn === 'min') bucket[name] = { value: values.reduce((a, b) => (compare(a, b) <= 0 ? a : b)) };
      else if (fn === 'sum') bucket[name] = { value: values.reduce((a, b) => a + Number(b), 0) };
      else if (fn === 'avg') bucket[name] = { value: values.reduce((a, b) => a + Number(b), 0) / values.length };
    }
  }
  return { groups: { buckets } };
}

export function executeSearchFixture(set, indexPattern, body = {}) {
  const names = Object.keys(set.data);
  const indices = matchIndices(indexPattern, names);
  const failure = Object.entries(set.errors || {})
    .find(([pattern]) => pattern === indexPattern || (pattern.endsWith('*') && String(indexPattern).startsWith(pattern.slice(0, -1))))?.[1];
  if (failure) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { type: failure.type, reason: failure.reason || failure.type } }) }] };
  }
  if (!indices.length) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { type: 'index_not_found_exception', reason: `no such index [${indexPattern}]` } }) }] };
  }
  let docs = indices.flatMap(name => set.data[name] || []);
  const clauses = body.query?.bool?.filter || (body.query ? [body.query] : []);
  docs = docs.filter(doc => clauses.every(clause => matchesClause(doc, clause)));
  const total = docs.length;
  if (body.sort) {
    for (const entry of [...body.sort].reverse()) {
      const [field, order] = Object.entries(entry)[0];
      docs.sort((a, b) => (order === 'desc' ? -1 : 1) * compare(get(a, field), get(b, field)));
    }
  }
  const aggregations = body.aggs ? termsAggregation(docs.filter(doc => clauses.every(clause => matchesClause(doc, clause))), body.aggs) : undefined;
  const rows = aggregations ? [] : docs.slice(0, body.size ?? 10).map(doc => project(doc, body._source));
  const payload = {
    hits: { total: { value: total, relation: 'eq' }, hits: rows.map(source => ({ _source: source })) },
    ...(aggregations ? { aggregations } : {}),
  };
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

// ---------------------------------------------------------------------------
// PPL evaluation for the approved generated grammar
// ---------------------------------------------------------------------------

export function executePplFixture(set, query) {
  // Mirrors the fail-closed production validator: only the shapes the compiler
  // generates are accepted; anything else is a rejected query.
  const sourceMatch = /^\s*(?:search\s+)?source\s*=\s*`?([a-z][a-z0-9_-]*)`?(.*)$/i.exec(String(query || ''));
  if (!sourceMatch) return pplError('ppl_invalid_query', 'unsupported PPL');
  const [, index, restText] = sourceMatch;
  const stages = restText.split('|').map(part => part.trim()).filter(Boolean);
  const wheres = [];
  let stats = null, sortSpec = null, head = null;
  for (const stage of stages) {
    const whereMatch = /^where\s+(.+)$/i.exec(stage);
    if (whereMatch) {
      const conditions = whereMatch[1].split(/\s+and\s+/i);
      for (const condition of conditions) {
        const parsed = /^`?([A-Za-z_@][A-Za-z0-9_.]*)`?\s*(=|!=|<=|>=|<|>)\s*('(?:[^'\\]|\\.)*'|[\w.\-]+)$/.exec(condition.trim());
        if (!parsed) return pplError('ppl_invalid_query', 'unsupported where clause');
        const literal = parsed[3].startsWith("'") ? parsed[3].slice(1, -1) : (Number.isNaN(Number(parsed[3])) ? parsed[3] : Number(parsed[3]));
        wheres.push({ field: parsed[1], op: parsed[2], value: literal });
      }
      continue;
    }
    const statsMatch = /^stats\s+count\(\)\s+as\s+(\w+)(?:\s+by\s+`?([A-Za-z_@][A-Za-z0-9_.]*)`?)?$/i.exec(stage);
    if (statsMatch) { stats = { as: statsMatch[1], by: statsMatch[2] || null }; continue; }
    const sortMatch = /^sort\s+([+-])\s*`?([A-Za-z_@][A-Za-z0-9_.]*)`?$/i.exec(stage);
    if (sortMatch) { sortSpec = { order: sortMatch[1] === '-' ? 'desc' : 'asc', field: sortMatch[2] }; continue; }
    const headMatch = /^head\s+(\d+)$/.exec(stage);
    if (headMatch) { head = Number(headMatch[1]); continue; }
    return pplError('ppl_invalid_query', `unsupported stage '${stage.slice(0, 40)}'`);
  }
  const names = Object.keys(set.data);
  const indices = matchIndices(index, names);
  if (!indices.length) return pplError('ppl_index_missing', `no such index [${index}]`);
  let docs = indices.flatMap(name => set.data[name] || []);
  for (const where of wheres) {
    docs = docs.filter(doc => {
      const value = get(doc, where.field);
      switch (where.op) {
        case '=': return compare(value, where.value) === 0;
        case '!=': return compare(value, where.value) !== 0;
        case '<': return compare(value, where.value) < 0;
        case '<=': return compare(value, where.value) <= 0;
        case '>': return compare(value, where.value) > 0;
        case '>=': return compare(value, where.value) >= 0;
        default: return false;
      }
    });
  }
  let rows;
  if (stats) {
    const groups = new Map();
    for (const doc of docs) {
      const key = stats.by ? get(doc, stats.by) : '__all__';
      groups.set(String(key), (groups.get(String(key)) || 0) + 1);
    }
    rows = [...groups.entries()].map(([key, count]) => ({ ...(stats.by ? { [stats.by]: key === '__all__' ? null : key } : {}), [stats.as]: count }));
  } else {
    rows = docs.map(doc => doc);
  }
  if (sortSpec) rows.sort((a, b) => (sortSpec.order === 'desc' ? -1 : 1) * compare(a[sortSpec.field], b[sortSpec.field]));
  const limit = head ?? 100;
  const truncated = rows.length > limit;
  rows = rows.slice(0, limit);
  const schemaNames = rows.length ? Object.keys(rows[0]) : (stats ? [...(stats.by ? [stats.by] : []), stats.as] : []);
  return { isError: false, content: [{ type: 'text', text: JSON.stringify({
    schema: schemaNames.map(name => ({ name, type: typeof rows[0]?.[name] === 'number' ? 'bigint' : 'string' })),
    datarows: rows.map(row => schemaNames.map(name => row[name] ?? null)),
    total: rows.length, limitReached: truncated,
  }) }] };
}

function pplError(type, reason) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { type, reason } }) }] };
}

// ---------------------------------------------------------------------------
// Mock MCP client + PPL executor (shapes match the production adapters)
// ---------------------------------------------------------------------------

export function fixtureMappingFor(set, indexPattern) {
  // Mapping discovery output built from the fixture documents themselves.
  const names = Object.keys(set.data);
  const indices = matchIndices(indexPattern, names);
  const properties = {};
  for (const doc of indices.flatMap(name => set.data[name] || []).slice(0, 50)) {
    for (const [key, value] of Object.entries(doc)) {
      if (value === null || value === undefined) continue;
      const type = typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'float')
        : typeof value === 'boolean' ? 'boolean'
        : /^\d{4}-\d{2}-\d{2}/.test(String(value)) && key.match(/date|time/) ? 'date' : 'keyword';
      properties[key] = properties[key] || { type };
    }
  }
  return { [indices[0] || names[0] || String(indexPattern)]: { mappings: { properties } } };
}

export function createFixtureMcpClient({ set, catalog = null } = {}) {
  const counts = { toolsList: 0, listIndex: 0, mapping: 0, search: 0, searchErrors: 0, total: 0, calls: [] };
  return {
    counts,
    async listTools() { counts.toolsList += 1; counts.total += 1; return { tools: FIXTURE_TOOLS }; },
    async callTool({ name, arguments: args = {} }) {
      counts.total += 1;
      counts.calls.push({ name, args });
      if (name === 'ListIndexTool') {
        counts.listIndex += 1;
        return { isError: false, content: [{ type: 'text', text: JSON.stringify(Object.keys(set.data)) }] };
      }
      if (name === 'IndexMappingTool') {
        counts.mapping += 1;
        return { isError: false, content: [{ type: 'text', text: JSON.stringify(fixtureMappingFor(set, args.index)) }] };
      }
      if (name === 'SearchIndexTool') {
        counts.search += 1;
        const result = executeSearchFixture(set, args.index, args);
        if (result.isError) counts.searchErrors += 1;
        return result;
      }
      return { isError: true, content: [{ type: 'text', text: '{"error":"unknown tool"}' }] };
    },
    async close() {},
  };
}

export function createFixturePplExecute({ set } = {}) {
  const counts = { ppl: 0, errors: 0, calls: [] };
  const execute = async (config, args) => {
    counts.ppl += 1;
    counts.calls.push({ query: args?.query });
    const result = executePplFixture(set, args?.query);
    if (result.isError) counts.errors += 1;
    return result;
  };
  execute.counts = counts;
  return execute;
}
