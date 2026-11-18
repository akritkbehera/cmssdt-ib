// QUERY skill (v1): compile validated parameterized templates — or a Kimi
// structured plan that is validated and compiled in code — into bounded
// read-only queries, execute them through the existing MCP/PPL read paths, and
// classify every outcome explicitly.
//
// Rules enforced here (never left to the model):
//   - only catalog field IDs may appear in plans; they resolve to real fields
//     of the named dataset (exact-match vs full-text semantics respected);
//   - nested fields are queried through their declared nested path;
//   - parameter values are type-checked against the template declarations;
//   - sort/aggregation fields must be keyword/numeric/date, bounded in size;
//   - result sizes are bounded (rows and buckets);
//   - multi-dataset results combine only on a verified join key at the
//     granularity the relationship declares;
//   - mapping discovery runs only when needed and is cached;
//   - retries are bounded and missing/closed/unauthorized/unmapped indices are
//     reported as distinct outcomes instead of silent emptiness.
import { buildSearchArgs } from '../templates.mjs';
import { validatePpl, PPL_TOOL_NAME } from '../ppl.mjs';
import { nullDiagnostics } from '../diagnostics.mjs';

export const QUERY_LIMITS = { rows: 100, buckets: 20, select: 24, filters: 12, attempts: 2 };

const DATASET_ID_RE = /^[a-z][a-z0-9_]*$/i;
const FIELD_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

// ---------------------------------------------------------------------------
// Plan IR validation and compilation
// ---------------------------------------------------------------------------

function fieldIndex(catalog) {
  return new Map(catalog.fields.map(field => [field.fieldId, field]));
}

function checkParamType(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string' && value.length > 0 && value.length <= 200;
    case 'string_list': return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(item => typeof item === 'string');
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'date': return typeof value === 'string' && (/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isFinite(Number(value)));
    default: return false;
  }
}

const SORTABLE_TYPES = new Set(['keyword', 'integer', 'long', 'double', 'float', 'boolean', 'date']);
const NUMERIC_TYPES = new Set(['integer', 'long', 'double', 'float']);

export class PlanError extends Error {
  constructor(code, detail) { super(detail); this.code = code; this.detail = detail; }
}

// Validate one template's declared parameters against resolved values.
export function bindTemplateParams(template, params, catalog) {
  const fields = fieldIndex(catalog);
  const bound = {};
  const errors = [];
  for (const spec of Object.values(template.params)) {
    const value = params[spec.name];
    if (value === undefined || value === null) {
      if (!spec.optional) errors.push(new PlanError('missing_param', `parameter '${spec.name}' is required by template '${template.templateId}'`));
      continue;
    }
    if (!checkParamType(value, spec.type)) {
      errors.push(new PlanError('param_type', `parameter '${spec.name}' must be ${spec.type}, got ${JSON.stringify(value)}`));
      continue;
    }
    if (spec.field && !fields.has(spec.field)) {
      errors.push(new PlanError('unknown_field', `parameter '${spec.name}' binds unknown field '${spec.field}'`));
      continue;
    }
    bound[spec.name] = value;
  }
  return { bound, errors };
}

// Expand a time-window parameter into concrete range bounds. Presets resolve
// against the caller's clock (the replay evaluation injects a fixed clock so
// runs are deterministic).
export function expandTimeWindow(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return {};
  if (value.from || value.to) return { from: value.from ?? null, to: value.to ?? null };
  const preset = /last-(\d+)-(hours|days|weeks)/.exec(String(value.preset || ''));
  if (preset) {
    const unitMs = { hours: 3600000, days: 86400000, weeks: 604800000 }[preset[2]];
    return { from: new Date(now - Number(preset[1]) * unitMs).toISOString().slice(0, 10), to: null };
  }
  return {};
}

// Compile the template's declarative query into the plan IR.
function compileQueryBlock(template, bound, catalog, routeId, now) {
  const fields = fieldIndex(catalog);
  const errors = [];
  const filters = [];
  for (const raw of template.query?.filters || []) {
    const field = fields.get(raw.field);
    if (!field) { errors.push(new PlanError('unknown_field', `filter references unknown field '${raw.field}'`)); continue; }
    const value = raw.param !== undefined ? bound[raw.param] : raw.value;
    if (raw.param !== undefined && value === undefined) continue; // optional, unbound
    switch (raw.op) {
      case 'term':
        if (!field.exactMatch) errors.push(new PlanError('exact_match', `field '${field.fieldId}' is ${field.type} and cannot take an exact-match term filter`));
        else filters.push({ op: 'term', field: field.name, fieldId: field.fieldId, value, param: raw.param ?? null });
        break;
      case 'prefix':
        if (!field.keyword) errors.push(new PlanError('exact_match', `prefix filter needs a keyword field; '${field.fieldId}' is ${field.type}`));
        else filters.push({ op: 'prefix', field: field.name, fieldId: field.fieldId, value, param: raw.param ?? null });
        break;
      case 'range': {
        if (!['date', 'integer', 'long', 'double', 'float'].includes(field.type)) {
          errors.push(new PlanError('field_type', `range filter needs a date or numeric field; '${field.fieldId}' is ${field.type}`));
          break;
        }
        const rawRange = value && typeof value === 'object' ? value : {};
        const range = rawRange.preset ? expandTimeWindow(rawRange, now) : rawRange;
        filters.push({ op: 'range', field: field.name, fieldId: field.fieldId,
          from: range.from ?? raw.from ?? null, to: range.to ?? raw.to ?? null, param: raw.param ?? null });
        break;
      }
      case 'not_term':
        filters.push({ op: 'not_term', field: field.name, fieldId: field.fieldId, value, param: raw.param ?? null });
        break;
      case 'exists':
        filters.push({ op: 'exists', field: field.name, fieldId: field.fieldId, param: raw.param ?? null });
        break;
      case 'nested': {
        const path = field.nested || raw.path;
        if (!path) errors.push(new PlanError('nested_path', `field '${field.fieldId}' is nested but no nested path is declared`));
        else filters.push({ op: 'nested', path, field: field.name, fieldId: field.fieldId, inner: raw.inner || 'term', value, param: raw.param ?? null });
        break;
      }
      default:
        errors.push(new PlanError('filter_op', `unsupported filter op '${raw.op}'`));
    }
    if (filters.length > QUERY_LIMITS.filters) errors.push(new PlanError('bounds', `at most ${QUERY_LIMITS.filters} filters per query`));
  }

  const select = (template.query?.select || []).map(id => {
    const field = fields.get(id);
    if (!field) { errors.push(new PlanError('unknown_field', `select references unknown field '${id}'`)); return null; }
    return field.name;
  }).filter(Boolean);
  if (select.length > QUERY_LIMITS.select) errors.push(new PlanError('bounds', `at most ${QUERY_LIMITS.select} selected fields`));

  const sort = (template.query?.sort || []).map(raw => {
    const field = fields.get(raw.field);
    if (!field) { errors.push(new PlanError('unknown_field', `sort references unknown field '${raw.field}'`)); return null; }
    if (!SORTABLE_TYPES.has(field.type)) { errors.push(new PlanError('field_type', `field '${field.fieldId}' (${field.type}) is not sortable`)); return null; }
    return { field: field.name, order: raw.order === 'asc' ? 'asc' : 'desc' };
  }).filter(Boolean);

  let aggregate = null;
  if (template.query?.aggregate) {
    const raw = template.query.aggregate;
    const field = raw.field ? fields.get(raw.field) : null;
    if (raw.field && !field) errors.push(new PlanError('unknown_field', `aggregate references unknown field '${raw.field}'`));
    else if (field && !(field.keyword || NUMERIC_TYPES.has(field.type))) {
      errors.push(new PlanError('field_type', `aggregate field '${field.fieldId}' must be keyword or numeric, is ${field.type}`));
    }
    const size = Math.min(Number(raw.size) || QUERY_LIMITS.buckets, QUERY_LIMITS.buckets);
    const subAggs = (raw.sub_aggs || []).map(sub => {
      const subField = fields.get(sub.field);
      if (!subField) { errors.push(new PlanError('unknown_field', `sub-aggregation references unknown field '${sub.field}'`)); return null; }
      if (!NUMERIC_TYPES.has(subField.type) && subField.type !== 'date') {
        errors.push(new PlanError('field_type', `sub-aggregation field '${sub.field}' must be numeric or date`));
        return null;
      }
      return { fn: ['min', 'max', 'sum', 'avg'].includes(sub.fn) ? sub.fn : null, field: subField.name, as: sub.as || `${sub.fn}_${subField.name}` };
    }).filter(entry => entry && entry.fn);
    if (field) aggregate = { type: 'terms', field: field.name, fieldId: field.fieldId, size, subAggs };
  }

  const size = Math.min(Number(template.query?.size) || QUERY_LIMITS.rows, QUERY_LIMITS.rows);
  return { ir: { templateId: template.templateId, routeId, datasetId: template.datasetId, transport: 'opensearch-dsl',
    filters, select, sort, size, aggregate }, errors };
}

// Validate + compile a model-produced structured plan (Kimi) against the
// catalog. Plans reference dataset ids and field ids only; the compiler is the
// single place where real names and DSL are produced.
export function compilePlan(plan, { catalog, retrieval, routeId = null } = {}) {
  const fields = fieldIndex(catalog);
  const errors = [];
  if (!plan || typeof plan !== 'object') return { ok: false, errors: [new PlanError('plan_shape', 'plan must be an object')] };
  const datasetId = String(plan.dataset_id || '');
  if (!DATASET_ID_RE.test(datasetId) || !catalog.datasets.some(dataset => dataset.datasetId === datasetId)) {
    return { ok: false, errors: [new PlanError('unknown_dataset', `plan dataset '${datasetId}' is not in the catalog`)] };
  }
  const scope = new Set(retrieval?.route?.datasets || catalog.datasets.map(dataset => dataset.datasetId));
  if (!scope.has(datasetId)) errors.push(new PlanError('out_of_scope', `dataset '${datasetId}' is not part of route '${retrieval?.route?.routeId || routeId || 'unknown'}'`));

  const filters = [];
  for (const raw of (plan.filters || []).slice(0, QUERY_LIMITS.filters)) {
    const field = fields.get(String(raw?.field_id || ''));
    if (!field || field.datasetId !== datasetId) { errors.push(new PlanError('unknown_field', `filter field '${raw?.field_id}' is not a field of '${datasetId}'`)); continue; }
    const op = raw.op;
    if (op === 'term' || op === 'not_term') {
      if (!field.exactMatch) errors.push(new PlanError('exact_match', `field '${field.fieldId}' is ${field.type}; use a keyword/numeric field for exact match or a prefix/text query`));
      else if (!checkParamType(raw.value, field.type === 'date' ? 'date' : field.type === 'integer' || field.type === 'long' ? 'integer' : 'string')) {
        errors.push(new PlanError('param_type', `filter value ${JSON.stringify(raw.value)} does not match field '${field.fieldId}' (${field.type})`));
      } else filters.push({ op, field: field.name, fieldId: field.fieldId, value: raw.value });
    } else if (op === 'prefix') {
      if (!field.keyword) errors.push(new PlanError('exact_match', `prefix needs a keyword field; '${field.fieldId}' is ${field.type}`));
      else filters.push({ op, field: field.name, fieldId: field.fieldId, value: String(raw.value) });
    } else if (op === 'range') {
      if (!['date', 'integer', 'long', 'double', 'float'].includes(field.type)) errors.push(new PlanError('field_type', `range needs a date/numeric field; '${field.fieldId}' is ${field.type}`));
      else filters.push({ op: 'range', field: field.name, fieldId: field.fieldId, from: raw.from ?? null, to: raw.to ?? null });
    } else if (op === 'nested') {
      if (!field.nested) errors.push(new PlanError('nested_path', `field '${field.fieldId}' is not declared nested`));
      else filters.push({ op: 'nested', path: field.nested, field: field.name, fieldId: field.fieldId, inner: 'term', value: raw.value });
    } else {
      errors.push(new PlanError('filter_op', `unsupported filter op '${op}'`));
    }
  }

  const select = (plan.select || []).slice(0, QUERY_LIMITS.select).map(id => {
    const field = fields.get(String(id));
    if (!field || field.datasetId !== datasetId) { errors.push(new PlanError('unknown_field', `select field '${id}' is not a field of '${datasetId}'`)); return null; }
    return field.name;
  }).filter(Boolean);

  const sort = (plan.sort || []).map(raw => {
    const field = fields.get(String(raw?.field_id || ''));
    if (!field || field.datasetId !== datasetId) { errors.push(new PlanError('unknown_field', `sort field '${raw?.field_id}' is not a field of '${datasetId}'`)); return null; }
    if (!SORTABLE_TYPES.has(field.type)) { errors.push(new PlanError('field_type', `sort field '${field.fieldId}' (${field.type}) is not sortable`)); return null; }
    return { field: field.name, order: raw.order === 'asc' ? 'asc' : 'desc' };
  }).filter(Boolean);

  let aggregate = null;
  if (plan.aggregate) {
    const raw = plan.aggregate;
    const field = fields.get(String(raw?.field_id || ''));
    if (!field || field.datasetId !== datasetId) errors.push(new PlanError('unknown_field', `aggregate field '${raw?.field_id}' is not a field of '${datasetId}'`));
    else if (!(field.keyword || NUMERIC_TYPES.has(field.type))) errors.push(new PlanError('field_type', `aggregate field '${field.fieldId}' must be keyword or numeric`));
    else aggregate = { type: 'terms', field: field.name, fieldId: field.fieldId, size: Math.min(Number(raw.size) || QUERY_LIMITS.buckets, QUERY_LIMITS.buckets), subAggs: [] };
  }

  const size = Math.min(Number(plan.size) || QUERY_LIMITS.rows, QUERY_LIMITS.rows);
  const dataset = catalog.datasets.find(entry => entry.datasetId === datasetId);
  const ir = { templateId: null, routeId, datasetId, transport: 'opensearch-dsl', index: dataset.index,
    filters, select, sort, size, aggregate };
  return { ok: errors.length === 0, errors, ir };
}

// Compile a validated template into the plan IR (params already bound).
export function compileTemplate(template, { params = {}, catalog, routeId = null, now = Date.now() } = {}) {
  const { bound, errors } = bindTemplateParams(template, params, catalog);
  if (errors.length) return { ok: false, errors, ir: null, bound };
  const dataset = catalog.datasets.find(entry => entry.datasetId === template.datasetId);
  if (!dataset) return { ok: false, errors: [new PlanError('unknown_dataset', `template '${template.templateId}' names unknown dataset '${template.datasetId}'`)], ir: null, bound };
  if (template.transport === 'ppl') {
    const compiled = compilePpl(template, bound, dataset, catalog);
    if (compiled.errors.length) return { ok: false, errors: compiled.errors, ir: null, bound };
    return { ok: true, errors: [], bound, ir: { templateId: template.templateId, routeId, datasetId: template.datasetId,
      transport: 'ppl', index: compiled.index, ppl: compiled.query, size: compiled.maxRows,
      filters: compiled.filters, select: [], sort: [], aggregate: compiled.aggregate } };
  }
  const { ir, errors: queryErrors } = compileQueryBlock(template, bound, catalog, routeId, now);
  ir.index = dataset.index;
  return { ok: queryErrors.length === 0, errors: queryErrors, bound, ir };
}

// PPL compilation runs through the existing fail-closed validator (same
// grammar, allowlist and trailing head semantics as the production tool).
// Field references are catalog field ids, resolved to real names here.
function compilePpl(template, bound, dataset, catalog) {
  const fields = fieldIndex(catalog);
  const spec = template.ppl || {};
  const errors = [];
  const filters = [];
  const parts = [];
  const resolve = id => {
    const field = fields.get(String(id));
    if (!field) { errors.push(new PlanError('unknown_field', `PPL references unknown field '${id}'`)); return null; }
    return field;
  };
  const index = String(spec.source || dataset.index || '');
  if (index.includes('*')) errors.push(new PlanError('ppl_source', 'PPL requires a concrete index name; this template only has an index pattern'));
  parts.push(`source = ${index}`);
  for (const where of spec.where || []) {
    const value = where.param !== undefined ? bound[where.param] : where.value;
    if (value === undefined || value === null) continue;
    const field = resolve(where.field);
    if (!field) continue;
    if (!['=', '!=', '<', '<=', '>', '>='].includes(where.op || '=')) {
      errors.push(new PlanError('ppl_op', `PPL where op '${where.op}' is outside the approved grammar`));
      continue;
    }
    const literal = typeof value === 'string' ? `'${value.replace(/'/g, '')}'` : String(value);
    parts.push(`where ${field.name} ${where.op || '='} ${literal}`);
    filters.push({ op: (where.op || '=') === '!=' ? 'not_term' : 'term', field: field.name, fieldId: field.fieldId, value });
  }
  let aggregate = null;
  if (spec.stats) {
    const fn = spec.stats.fn || 'count';
    const by = spec.stats.by ? resolve(spec.stats.by) : null;
    if (spec.stats.by && !by) { /* error already recorded */ }
    parts.push(`stats ${fn}() as total${by ? ` by ${by.name}` : ''}`);
    aggregate = by ? { type: 'terms', field: by.name, fieldId: by.fieldId, size: spec.stats.size || QUERY_LIMITS.buckets, subAggs: [] } : null;
  }
  if (spec.sort) parts.push(`sort ${spec.sort.startsWith('+') || spec.sort.startsWith('-') ? spec.sort : `- ${spec.sort}`}`);
  const maxRows = Math.min(Number(spec.head) || QUERY_LIMITS.rows, QUERY_LIMITS.rows);
  const query = parts.join(' | ');
  if (errors.length) return { index, query, maxRows, filters, aggregate, errors };
  try {
    const checked = validatePpl(query, { maxRows });
    return { index, query: checked.query, maxRows, filters, aggregate, errors };
  } catch (error) {
    errors.push(new PlanError('ppl_invalid', error?.message || 'PPL validation failed'));
    return { index, query, maxRows, filters, aggregate, errors };
  }
}

// Render the plan IR as a search body and map it onto the discovered
// SearchIndexTool input schema (the same helper the validated templates use).
export function buildSearchBody(ir) {
  const clauses = [];
  for (const filter of ir.filters) {
    switch (filter.op) {
      case 'term': clauses.push({ term: { [filter.field]: filter.value } }); break;
      case 'not_term': clauses.push({ bool: { must_not: [{ term: { [filter.field]: filter.value } }] } }); break;
      case 'prefix': clauses.push({ prefix: { [filter.field]: filter.value } }); break;
      case 'range': {
        const range = {};
        if (filter.from !== null && filter.from !== undefined) range.gte = filter.from;
        if (filter.to !== null && filter.to !== undefined) range.lte = filter.to;
        clauses.push({ range: { [filter.field]: range } });
        break;
      }
      case 'exists': clauses.push({ exists: { field: filter.field } }); break;
      case 'nested':
        clauses.push({ nested: { path: filter.path, query: { [filter.inner || 'term']: { [filter.field]: filter.value } } } });
        break;
    }
  }
  const body = { size: ir.size, query: { bool: { filter: clauses } } };
  if (ir.select?.length) body._source = ir.select;
  if (ir.sort?.length) body.sort = ir.sort.map(entry => ({ [entry.field]: entry.order }));
  if (ir.aggregate) {
    body.size = 0;
    body.aggs = { groups: { terms: { field: ir.aggregate.field, size: ir.aggregate.size },
      ...(ir.aggregate.subAggs?.length ? { aggs: Object.fromEntries(ir.aggregate.subAggs.map(sub => [sub.as, { [sub.fn]: { field: sub.field } }])) } : {}) } };
  }
  return body;
}

export function buildToolArgs(ir, searchSchema) {
  if (ir.transport === 'ppl') return { tool: PPL_TOOL_NAME, args: { query: ir.ppl, max_rows: ir.size } };
  const args = buildSearchArgs(searchSchema, { index: ir.index, body: buildSearchBody(ir) });
  return args ? { tool: 'SearchIndexTool', args } : null;
}

// ---------------------------------------------------------------------------
// Execution over the existing read-only paths
// ---------------------------------------------------------------------------

// Classify tool/execution failures into the explicit outcomes the ANSWER skill
// must distinguish. Detection is fail-closed: an unrecognized failure stays a
// query failure and is never reported as "no results".
export function classifyToolFailure(result, error) {
  const text = `${error?.message || ''} ${JSON.stringify(result?.content ?? result ?? {})}`;
  if (/index_not_found_exception|no such index|index_not_found/i.test(text)) return 'missing_index';
  if (/index_closed_exception|index_closed|closed index/i.test(text)) return 'closed_index';
  if (/security_exception|permission_denied|unauthorized|forbidden|authentication/i.test(text)) return 'unauthorized';
  if (/strict_dynamic_mapping|No mapping found|unmapped|Can't parse|failed to find field|no such field|mapper_parsing/i.test(text)) return 'unmapped_field';
  if (/too_many|too complex|circuit_breaking|Result window is too large|too_large|timeout/i.test(text)) return 'query_rejected';
  return 'query_failed';
}

function parseSearchResult(result) {
  if (result?.isError) return { ok: false, failure: classifyToolFailure(result, null) };
  const text = result?.content?.find?.(part => part.type === 'text')?.text ?? '';
  let payload;
  try { payload = JSON.parse(text); } catch { return { ok: false, failure: 'query_failed', detail: 'unparseable tool payload' }; }
  if (payload?.error) return { ok: false, failure: classifyToolFailure({ content: [{ type: 'text', text: JSON.stringify(payload.error) }] }, null) };
  return { ok: true, payload };
}

function summarizeSearch(payload, ir) {
  const hits = payload?.hits?.hits || [];
  const rows = hits.map(hit => hit._source ?? {});
  const total = typeof payload?.hits?.total === 'object' ? payload.hits.total.value
    : typeof payload?.hits?.total === 'number' ? payload.hits.total : rows.length;
  const aggregate = payload?.aggregations?.groups?.buckets
    ? { buckets: payload.aggregations.groups.buckets.map(bucket => ({ key: bucket.key, count: bucket.doc_count,
        ...Object.fromEntries(Object.entries(bucket).filter(([key]) => !['key', 'doc_count', 'key_as_string'].includes(key))
          .map(([key, value]) => [key, value?.value ?? null])) })) }
    : null;
  return { rows, total, aggregate, bounded: rows.length >= ir.size && !aggregate };
}

function summarizePpl(payload, ir) {
  const schema = payload?.schema || [];
  const names = schema.map(column => column.name);
  const rows = (payload?.datarows || []).map(row => Object.fromEntries(names.map((name, i) => [name, row[i]])));
  const aggregate = ir.aggregate ? { buckets: rows.map(row => ({ key: row[ir.aggregate.field], count: row.total ?? null })) } : null;
  return { rows: aggregate ? [] : rows, total: payload?.total ?? rows.length, aggregate, bounded: payload?.limitReached === true || rows.length >= ir.size };
}

// Execute compiled plans through the caller's session (MCP) and PPL executor.
// Identical queries dedupe; mapping discovery happens only for an
// `unmapped_field` failure or an explicitly unknown field type, once per index,
// and confirmed metadata is cached in the registry when one is provided.
export async function executeQueries({ plans, session, pplExecute, config, searchSchema, signal,
  diagnostics = nullDiagnostics, registry = null, dedupe = null, maxAttempts = QUERY_LIMITS.attempts }) {
  const results = [];
  const mappingChecked = new Set();
  for (const plan of plans) {
    const built = buildToolArgs(plan.ir, searchSchema);
    if (!built) {
      results.push({ plan, outcome: 'query_failed', detail: 'compiled query does not fit the discovered SearchIndexTool schema' });
      continue;
    }
    const key = `${built.tool}:${JSON.stringify(built.args)}`;
    if (dedupe?.get?.(key)) {
      results.push({ plan, outcome: 'success', ...(dedupe.get(key)), deduplicated: true });
      continue;
    }
    let attempt = 0, entry = null;
    while (attempt < maxAttempts && !entry) {
      attempt += 1;
      let raw;
      try {
        raw = plan.ir.transport === 'ppl'
          ? await (pplExecute || (() => { throw new Error('PPL execution is not available in this runtime'); }))(config, built.args, { signal, diagnostics })
          : await session.callTool('SearchIndexTool', built.args, { stage: 'tools/call', readOnly: true });
      } catch (error) {
        const failure = classifyToolFailure(null, error);
        if (failure === 'unmapped_field' && attempt < maxAttempts && plan.ir.transport !== 'ppl') {
          await discoverMapping({ session, index: plan.ir.index, registry, mappingChecked, diagnostics });
          continue;
        }
        entry = { plan, outcome: failure, detail: String(error?.message || error).slice(0, 200), attempts: attempt };
        break;
      }
      const parsed = parseSearchResult(raw);
      if (!parsed.ok) {
        if (parsed.failure === 'unmapped_field' && attempt < maxAttempts && plan.ir.transport !== 'ppl') {
          await discoverMapping({ session, index: plan.ir.index, registry, mappingChecked, diagnostics });
          continue;
        }
        if (parsed.failure === 'missing_index' && attempt < maxAttempts && /\*/.test(String(plan.ir.index))) {
          // One bounded index-listing check to report the family state clearly.
          const listed = await session.callTool('ListIndexTool', {}, { stage: 'tools/call', readOnly: true }).catch(() => null);
          const names = parseIndexNames(listed);
          entry = { plan, outcome: 'missing_index', detail: names.length
            ? `no matching index for '${plan.ir.index}'; open indices include ${names.slice(0, 8).join(', ')}`
            : `no matching index for '${plan.ir.index}'`, attempts: attempt };
          break;
        }
        entry = { plan, outcome: parsed.failure, detail: parsed.detail || 'tool returned an error', attempts: attempt };
        break;
      }
      const summary = plan.ir.transport === 'ppl' ? summarizePpl(parsed.payload, plan.ir) : summarizeSearch(parsed.payload, plan.ir);
      entry = { plan, outcome: 'success', ...summary, attempts: attempt };
    }
    if (entry.outcome === 'success') dedupe?.set?.(key, entry);
    results.push(entry);
  }
  return results;
}

async function discoverMapping({ session, index, registry, mappingChecked, diagnostics }) {
  const key = String(index);
  if (mappingChecked.has(key)) return null;
  mappingChecked.add(key);
  try {
    const result = await session.callTool('IndexMappingTool', { index: key }, { stage: 'tools/call', readOnly: true });
    const parsed = parseSearchResult(result);
    if (parsed.ok && registry?.recordMapping) registry.recordMapping({ index: key, mapping: parsed.payload });
    diagnostics?.log?.('mapping_discovery', { stage: 'tools/call', index: key, outcome: parsed.ok ? 'ok' : 'error' });
    return parsed.ok ? parsed.payload : null;
  } catch { return null; }
}

function parseIndexNames(result) {
  const text = result?.content?.find?.(part => part.type === 'text')?.text ?? '[]';
  try {
    const payload = JSON.parse(text);
    return (Array.isArray(payload) ? payload : payload?.indices && Array.isArray(payload.indices) ? payload.indices
      : payload?.indices && typeof payload.indices === 'object' ? Object.keys(payload.indices) : []).filter(name => typeof name === 'string');
  } catch { return []; }
}

// Combine multi-dataset results only on a verified join key at the declared
// granularity. Without a verified join the results stay separate and say so.
export function combineResults(results, joins = [], { granularity = null } = {}) {
  const successes = results.filter(result => result.outcome === 'success' && result.rows?.length !== undefined);
  const join = joins.find(entry => !granularity || entry.granularity === granularity);
  if (!join || successes.length < 2) {
    return { combined: false, reason: join ? 'fewer than two successful datasets' : 'no verified join key at this granularity',
      results, rows: successes.flatMap(result => result.rows.map(row => ({ ...row, __dataset: result.plan.ir.datasetId }))) };
  }
  const [left, right] = successes;
  const [leftField, rightField] = [basename(join.source), basename(join.target)];
  const rightIndex = new Map(right.rows.map(row => [String(row[rightField]), row]));
  const rows = [];
  for (const row of left.rows) {
    const match = rightIndex.get(String(row[leftField]));
    if (match) rows.push({ ...row, ...Object.fromEntries(Object.entries(match).filter(([key]) => !(key in row))) });
  }
  return { combined: true, join: { left: leftField, right: rightField, granularity: join.granularity, confidence: join.confidence },
    results, rows, unmatched: left.rows.length - rows.length };
}

const basename = fieldId => String(fieldId).split('.').pop();

// Compact query-scope summary for the evidence bundle and citations.
export function describeScope(plans, params) {
  return plans.map(plan => {
    const ir = plan.ir || plan;
    const filters = (ir.filters || []).map(filter => filter.op === 'range'
      ? `${filter.field} in [${filter.from ?? '*'} .. ${filter.to ?? '*'}]`
      : `${filter.field} ${filter.op === 'not_term' ? '!=' : filter.op === 'prefix' ? 'starts with' : '='} ${JSON.stringify(filter.value)}`);
    return { dataset: ir.datasetId, index: ir.index, transport: ir.transport, template: ir.templateId,
      filters, size: ir.size, aggregate: ir.aggregate ? `${ir.aggregate.type}(${ir.aggregate.field}, ${ir.aggregate.size} buckets)` : null };
  });
}
