// Versioned CMSSDT knowledge-graph catalog loader.
//
// The catalog is published by the opensearch-knowledge pipeline as
// `opensearch-knowledge/catalog.json` (single document) or `catalog/*.json`
// (split documents). The shared v1 contract has top-level `schema_version`,
// `snapshot`, `datasets`, `fields`, `relationships`, `routes` and `templates`.
//
// This loader is tolerant in shape (list keys or one-key wrapper objects,
// `id`/`field_id` aliases) but strict in meaning: every reference must resolve,
// every route must name real datasets, every template must declare typed
// parameters bound to real fields. Catalog text and values are treated as
// data, never as instructions. Nothing here performs network or OpenSearch
// access; loading is a pure file operation.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const SUPPORTED_SCHEMA_MAJORS = [1];
export const CONTRACT_KEYS = ['schema_version', 'snapshot', 'datasets', 'fields', 'relationships', 'routes', 'templates'];

const asList = value => Array.isArray(value) ? value
  : value && typeof value === 'object' && Array.isArray(value.list) ? value.list
  : value && typeof value === 'object' && Object.keys(value).length === 1 && Array.isArray(Object.values(value)[0]) ? Object.values(value)[0]
  : [];

const scalar = value => (value === null || value === undefined) ? null
  : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;

// Accept both `schema_version: "1.0"` and `schema_version: 1`.
export function schemaMajor(version) {
  const text = String(version ?? '').trim();
  const match = /^v?(\d+)(?:\.(\d+))?$/.exec(text);
  return match ? Number(match[1]) : null;
}

function normalizeField(raw, index, errors) {
  const datasetId = scalar(raw?.dataset_id) || scalar(raw?.dataset) || null;
  const name = scalar(raw?.name) || scalar(raw?.field) || null;
  const fieldId = scalar(raw?.field_id) || scalar(raw?.id) || (datasetId && name ? `${datasetId}.${name}` : null);
  if (!fieldId || !datasetId || !name) {
    errors.push(`fields[${index}]: requires a field id, dataset_id and name`);
    return null;
  }
  const type = String(scalar(raw?.type) || scalar(raw?.dominant_type) || 'unknown');
  return {
    fieldId, datasetId, name, type,
    keyword: raw?.keyword === true || type === 'keyword',
    exactMatch: raw?.exact_match !== false && (raw?.keyword === true || type === 'keyword' || raw?.type === 'integer' || raw?.type === 'long' || raw?.type === 'boolean' || type === 'date'),
    role: scalar(raw?.role) || null,
    nested: scalar(raw?.nested_under) || scalar(raw?.nested_path) || null,
    description: String(scalar(raw?.description) || ''),
  };
}

function normalizeDataset(raw, index, errors) {
  const datasetId = scalar(raw?.dataset_id) || scalar(raw?.id) || null;
  if (!datasetId) { errors.push(`datasets[${index}]: requires a dataset id`); return null; }
  return {
    datasetId,
    description: String(scalar(raw?.description) || ''),
    index: String(scalar(raw?.index) || scalar(raw?.index_pattern) || ''),
    granularity: String(scalar(raw?.granularity) || 'document'),
    coverage: String(scalar(raw?.coverage?.status) || scalar(raw?.completeness) || 'unknown'),
    timeField: scalar(raw?.time_field) || null,
    keyFields: asList(raw?.key_fields || raw?.build_key).map(scalar).filter(Boolean),
    joinKeys: asList(raw?.join_keys).map(scalar).filter(Boolean),
  };
}

function normalizeRelationship(raw, index, errors) {
  const source = scalar(raw?.source?.field_id || raw?.source) || null;
  const target = scalar(raw?.target?.field_id || raw?.target) || null;
  if (!source || !target) { errors.push(`relationships[${index}]: requires source and target field ids`); return null; }
  return {
    relationshipId: scalar(raw?.relationship_id) || scalar(raw?.id) || `r-${index}`,
    source, target,
    type: String(scalar(raw?.type) || scalar(raw?.relationship_type) || 'related'),
    granularity: scalar(raw?.granularity) || null,
    confidence: String(scalar(raw?.confidence) || scalar(raw?.confidence_tier) || 'unknown'),
    description: String(scalar(raw?.description) || ''),
  };
}

function normalizeParam(raw, key, errors, where) {
  const type = String(scalar(raw?.type) || 'string');
  if (!['string', 'integer', 'number', 'boolean', 'date', 'string_list'].includes(type)) {
    errors.push(`${where}: parameter '${key}' has unsupported type '${type}'`);
    return null;
  }
  return { name: key, type, field: scalar(raw?.field) || null, op: String(scalar(raw?.op) || 'term'),
    optional: raw?.optional === true, description: String(scalar(raw?.description) || '') };
}

function normalizeTemplate(raw, index, errors) {
  const templateId = scalar(raw?.template_id) || scalar(raw?.id) || null;
  if (!templateId) { errors.push(`templates[${index}]: requires a template id`); return null; }
  const params = {};
  for (const [key, spec] of Object.entries(raw?.params || {})) {
    const param = normalizeParam(spec, key, errors, `templates[${index}] (${templateId})`);
    if (param) params[key] = param;
  }
  return {
    templateId,
    routeId: scalar(raw?.route_id) || null,
    datasetId: scalar(raw?.dataset_id) || null,
    transport: String(scalar(raw?.transport) || 'opensearch-dsl'),
    description: String(scalar(raw?.description) || ''),
    params,
    query: raw?.query && typeof raw.query === 'object' ? raw.query : null,
    ppl: raw?.ppl && typeof raw.ppl === 'object' ? raw.ppl : null,
    validated: raw?.validated === true,
  };
}

function normalizeRoute(raw, index, errors) {
  const routeId = scalar(raw?.route_id) || scalar(raw?.id) || null;
  const intent = scalar(raw?.intent) || null;
  if (!routeId || !intent) { errors.push(`routes[${index}]: requires a route id and intent`); return null; }
  return {
    routeId,
    intent: String(intent),
    description: String(scalar(raw?.description) || ''),
    datasets: asList(raw?.datasets).map(scalar).filter(Boolean),
    requiredParams: asList(raw?.required_params).map(String),
    optionalParams: asList(raw?.optional_params).map(String),
    templates: asList(raw?.templates).map(String),
    evidenceFields: asList(raw?.evidence_fields).map(String),
    completeness: String(scalar(raw?.completeness) || 'unknown'),
    granularity: scalar(raw?.granularity) || null,
    joinKeys: asList(raw?.join_keys).map(String),
    blockedWhen: asList(raw?.blocked_when).map(String),
    note: String(scalar(raw?.note) || ''),
  };
}

// Validate cross-references. The catalog is structural knowledge only: a
// broken reference is a data error, never repaired by guessing.
function crossCheck(doc, errors, warnings) {
  const datasetIds = new Set(doc.datasets.map(dataset => dataset.datasetId));
  const fieldIds = new Set(doc.fields.map(field => field.fieldId));
  const templateIds = new Set(doc.templates.map(template => template.templateId));
  const fieldById = new Map(doc.fields.map(field => [field.fieldId, field]));
  for (const field of doc.fields) {
    if (!datasetIds.has(field.datasetId)) errors.push(`field '${field.fieldId}': unknown dataset '${field.datasetId}'`);
    if (field.nested && field.nested !== 'object' && !field.nested.startsWith(field.datasetId)) {
      warnings.push(`field '${field.fieldId}': nested path '${field.nested}' does not name its dataset`);
    }
  }
  for (const rel of doc.relationships) {
    for (const end of [rel.source, rel.target]) {
      if (!fieldIds.has(end)) errors.push(`relationship '${rel.relationshipId}': unknown field '${end}'`);
    }
    const src = fieldById.get(rel.source), dst = fieldById.get(rel.target);
    if (src && dst && rel.type === 'join_key' && src.name !== dst.name && rel.granularity === null) {
      warnings.push(`relationship '${rel.relationshipId}': join key fields differ ('${src.name}' vs '${dst.name}') without a declared granularity`);
    }
  }
  for (const route of doc.routes) {
    for (const id of route.datasets) if (!datasetIds.has(id)) errors.push(`route '${route.routeId}': unknown dataset '${id}'`);
    for (const id of route.templates) if (!templateIds.has(id)) errors.push(`route '${route.routeId}': unknown template '${id}'`);
    for (const id of route.evidenceFields) if (!fieldIds.has(id)) errors.push(`route '${route.routeId}': unknown evidence field '${id}'`);
  }
  for (const template of doc.templates) {
    if (template.routeId && !doc.routes.some(route => route.routeId === template.routeId)) {
      errors.push(`template '${template.templateId}': unknown route '${template.routeId}'`);
    }
    if (template.datasetId && !datasetIds.has(template.datasetId)) {
      errors.push(`template '${template.templateId}': unknown dataset '${template.datasetId}'`);
    }
    if (template.transport === 'opensearch-dsl' && !template.query) {
      errors.push(`template '${template.templateId}': opensearch-dsl transport requires a query`);
    }
    if (template.transport === 'ppl' && !template.ppl) {
      errors.push(`template '${template.templateId}': ppl transport requires a ppl block`);
    }
    for (const param of Object.values(template.params)) {
      if (param.field && !fieldIds.has(param.field)) {
        errors.push(`template '${template.templateId}': parameter '${param.name}' binds unknown field '${param.field}'`);
      }
    }
    // Every filter/sort/aggregation field reference must resolve.
    const refs = [];
    const walk = value => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === 'object') {
        if (typeof value.field === 'string') refs.push(value.field);
        Object.values(value).forEach(walk);
      }
    };
    walk(template.query); walk(template.ppl);
    for (const ref of refs) {
      if (ref.startsWith('${') || ref === 'source') continue;
      if (!fieldIds.has(ref)) errors.push(`template '${template.templateId}': query references unknown field '${ref}'`);
    }
  }
}

// Normalize one raw catalog document (the single-file or merged split shape).
export function parseCatalog(raw, { source = 'inline' } = {}) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, source, errors: ['catalog must be a JSON object'], warnings, catalog: null };
  }
  const version = raw.schema_version ?? raw.schemaVersion ?? raw.version;
  const major = schemaMajor(version);
  if (major === null) errors.push(`schema_version '${version ?? ''}' is not a version number`);
  else if (!SUPPORTED_SCHEMA_MAJORS.includes(major)) {
    errors.push(`schema_version '${version}' is unsupported; this loader reads major version ${SUPPORTED_SCHEMA_MAJORS.join(', ')}`);
  }
  const missing = CONTRACT_KEYS.filter(key => raw[key] === undefined);
  if (missing.length) errors.push(`catalog is missing top-level keys: ${missing.join(', ')}`);

  const datasets = asList(raw.datasets).map((entry, i) => normalizeDataset(entry, i, errors)).filter(Boolean);
  const fields = asList(raw.fields).map((entry, i) => normalizeField(entry, i, errors)).filter(Boolean);
  const relationships = asList(raw.relationships).map((entry, i) => normalizeRelationship(entry, i, errors)).filter(Boolean);
  const routes = asList(raw.routes).map((entry, i) => normalizeRoute(entry, i, errors)).filter(Boolean);
  const templates = asList(raw.templates).map((entry, i) => normalizeTemplate(entry, i, errors)).filter(Boolean);

  const doc = {
    schemaVersion: String(version),
    schemaMajor: major,
    snapshot: raw.snapshot && typeof raw.snapshot === 'object'
      ? { id: scalar(raw.snapshot.id) || scalar(raw.snapshot.snapshot) || null,
          generatedAt: scalar(raw.snapshot.generated_at) || scalar(raw.snapshot.generatedAt) || null,
          source: scalar(raw.snapshot.source) || null, ...raw.snapshot }
      : { id: scalar(raw.snapshot) || null, generatedAt: null, source: null },
    datasets, fields, relationships, routes, templates,
    source,
    loadedAt: new Date().toISOString(),
  };
  if (errors.length) return { ok: false, source, errors, warnings, catalog: doc };
  crossCheck(doc, errors, warnings);
  return { ok: errors.length === 0, source, errors, warnings, catalog: doc };
}

// Merge the split `catalog/*.json` form into one raw document. Wrapper files
// each own one contract key; unknown extra files are ignored with a warning.
async function loadSplitCatalog(dir) {
  const names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
  const merged = {};
  const warnings = [];
  for (const name of names) {
    let parsed;
    try { parsed = JSON.parse(await readFile(join(dir, name), 'utf8')); }
    catch (error) { return { ok: false, errors: [`${name}: invalid JSON (${error.message})`] }; }
    if (name === 'catalog.json') {
      Object.assign(merged, parsed);
      continue;
    }
    let used = false;
    for (const key of CONTRACT_KEYS) {
      if (parsed[key] !== undefined && merged[key] === undefined) { merged[key] = parsed[key]; used = true; }
    }
    if (!used) warnings.push(`${name}: no contract key matched; ignored`);
  }
  return { raw: merged, warnings };
}

// Load a catalog from a file path or a directory. Missing/unreadable catalogs
// fail closed with a structured result; callers decide how to report.
export async function loadCatalog(path) {
  if (!path) return { ok: false, source: null, errors: ['no catalog path configured'], warnings: [], catalog: null };
  let raw, warnings = [], source = path;
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      const candidate = join(path, 'catalog.json');
      try {
        await stat(candidate);
        raw = JSON.parse(await readFile(candidate, 'utf8'));
        source = candidate;
      } catch (error) {
        if (error?.code === 'ENOENT') {
          const split = await loadSplitCatalog(path);
          if (!split.raw) return { ok: false, source: path, errors: split.errors || ['directory has no catalog.json'], warnings: [], catalog: null };
          raw = split.raw; warnings = split.warnings;
        } else if (error?.code === 'ENOTDIR') {
          raw = JSON.parse(await readFile(path, 'utf8'));
        } else {
          return { ok: false, source: candidate, errors: [`catalog.json: ${error.message}`], warnings: [], catalog: null };
        }
      }
    } else {
      raw = JSON.parse(await readFile(path, 'utf8'));
    }
  } catch (error) {
    return { ok: false, source: path, errors: [error?.code === 'ENOENT' ? `catalog not found at ${path}` : `catalog could not be read: ${error.message}`], warnings: [], catalog: null };
  }
  const parsed = parseCatalog(raw, { source });
  return { ...parsed, warnings: [...warnings, ...parsed.warnings] };
}

// Compact, bounded catalog summary for prompts and diagnostics. Structural
// facts only; deterministic ordering.
export function describeCatalog(catalog, { maxChars = 2400 } = {}) {
  if (!catalog) return '';
  const lines = [
    `Knowledge graph snapshot ${catalog.snapshot.id || 'unknown'} (schema v${catalog.schemaVersion}, generated ${catalog.snapshot.generatedAt || 'unknown'}), loaded from ${catalog.source}.`,
    `Datasets (${catalog.datasets.length}): ${catalog.datasets.map(dataset => `${dataset.datasetId}[${dataset.index || 'no-index'}, ${dataset.granularity}, coverage=${dataset.coverage}]`).join('; ')}`,
    `Routes (${catalog.routes.length}): ${catalog.routes.map(route => `${route.routeId}→${route.intent}`).join('; ')}`,
    `Templates: ${catalog.templates.map(template => template.templateId).join('; ') || 'none'}`,
  ];
  return lines.join('\n').slice(0, maxChars);
}
