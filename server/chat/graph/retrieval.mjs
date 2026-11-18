// Compact deterministic graph retrieval for the IB Insights skills.
//
// Given a typed intent and resolved parameters, select exactly the graph
// entries a route needs: the route itself, its datasets, the parameter- and
// evidence-bound fields, one hop of related field IDs via declared
// relationships, and the parameterized templates. Everything is bounded and
// stably ordered so the same inputs always produce the same bundle (replay
// evaluations depend on this). No heuristics beyond explicit contract data.
export const RETRIEVAL_LIMITS = { fields: 60, relationships: 24, templates: 6, datasets: 8 };

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const COMPLETENESS_RANK = { per_test: 4, per_workflow: 3, complete: 3, partial: 2, aggregate_only: 1, unknown: 0 };

// Parameters that name concrete entities bind to fields through templates and
// route declarations; the router resolves them before retrieval.
export function paramBindings(route, templates, catalog) {
  const fieldById = new Map(catalog.fields.map(field => [field.fieldId, field]));
  const bindings = {};
  for (const param of [...route.requiredParams, ...route.optionalParams]) bindings[param] = null;
  for (const template of templates) {
    for (const [name, spec] of Object.entries(template.params)) {
      if (bindings[name] === null && spec.field && fieldById.has(spec.field)) bindings[name] = spec.field;
    }
  }
  return bindings;
}

// One hop of relationship expansion: fields related to the selected set
// (join keys and related fields), restricted to datasets already in scope or
// explicitly joined to them. Bounded and sorted.
export function relatedFields(selectedFieldIds, catalog, { limit = RETRIEVAL_LIMITS.relationships } = {}) {
  const selected = new Set(selectedFieldIds);
  const out = [];
  for (const rel of catalog.relationships) {
    const touches = selected.has(rel.source) || selected.has(rel.target);
    if (!touches) continue;
    out.push(rel);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => byId(a.relationshipId, b.relationshipId));
}

// Rank candidate routes for an intent: richer completeness first (per-test
// detail beats aggregate-only when both serve the intent), then stable by id.
export function rankRoutes(catalog, intent) {
  return catalog.routes
    .filter(route => route.intent === intent)
    .slice()
    .sort((a, b) => (COMPLETENESS_RANK[b.completeness] ?? 0) - (COMPLETENESS_RANK[a.completeness] ?? 0) || byId(a.routeId, b.routeId));
}

// Main entry: deterministic retrieval bundle for one intent + parameters.
// `preferCompleteness` lets the router request aggregate-only evidence when the
// question only needs counts; otherwise the richest route wins.
export function retrieve(catalog, { intent, params = {}, preferCompleteness = null, routeId = null, limit = RETRIEVAL_LIMITS } = {}) {
  const fieldById = new Map(catalog.fields.map(field => [field.fieldId, field]));
  const datasetById = new Map(catalog.datasets.map(dataset => [dataset.datasetId, dataset]));
  let routes = rankRoutes(catalog, intent);
  if (routeId) routes = routes.filter(route => route.routeId === routeId);
  if (preferCompleteness) {
    routes = routes.slice().sort((a, b) => {
      const aWant = a.completeness === preferCompleteness ? 1 : 0;
      const bWant = b.completeness === preferCompleteness ? 1 : 0;
      return bWant - aWant || (COMPLETENESS_RANK[b.completeness] ?? 0) - (COMPLETENESS_RANK[a.completeness] ?? 0) || byId(a.routeId, b.routeId);
    });
  }
  const route = routes[0] || null;
  const templates = (route ? route.templates : [])
    .map(id => catalog.templates.find(template => template.templateId === id))
    .filter(Boolean)
    .slice(0, limit.templates);

  const missingParams = route ? route.requiredParams.filter(name => params[name] === undefined || params[name] === null) : [];

  const datasets = (route?.datasets || [])
    .map(id => datasetById.get(id))
    .filter(Boolean)
    .slice(0, limit.datasets);

  // Field selection: parameter bindings + evidence fields + template query
  // field references, restricted to the route's datasets; then one hop of
  // related field IDs. Unknown references were already rejected by the loader.
  const wanted = new Set();
  const bindings = route ? paramBindings(route, templates, catalog) : {};
  for (const fieldId of Object.values(bindings)) if (fieldId) wanted.add(fieldId);
  for (const fieldId of route?.evidenceFields || []) wanted.add(fieldId);
  const walkRefs = value => {
    if (Array.isArray(value)) return value.forEach(walkRefs);
    if (value && typeof value === 'object') {
      if (typeof value.field === 'string') wanted.add(value.field);
      Object.values(value).forEach(walkRefs);
    }
  };
  for (const template of templates) { walkRefs(template.query); walkRefs(template.ppl); }
  const scope = new Set((route?.datasets || []));
  let fields = [...wanted]
    .map(id => fieldById.get(id))
    .filter(field => field && (scope.size === 0 || scope.has(field.datasetId)))
    .sort((a, b) => byId(a.datasetId, b.datasetId) || byId(a.name, b.name))
    .slice(0, limit.fields);

  const relationships = relatedFields(fields.map(field => field.fieldId), catalog, { limit: limit.relationships });
  for (const rel of relationships) {
    for (const end of [rel.source, rel.target]) {
      const field = fieldById.get(end);
      if (field && !fields.some(existing => existing.fieldId === field.fieldId) && fields.length < limit.fields) fields.push(field);
    }
  }
  fields = fields.sort((a, b) => byId(a.datasetId, b.datasetId) || byId(a.name, b.name));

  // Join keys usable to combine multi-dataset results, with the granularity at
  // which combining is valid.
  const joins = relationships
    .filter(rel => rel.type === 'join_key' && scope.has(fieldById.get(rel.source)?.datasetId) && scope.has(fieldById.get(rel.target)?.datasetId))
    .map(rel => ({ source: rel.source, target: rel.target, granularity: rel.granularity, confidence: rel.confidence }));

  return {
    intent,
    route,
    alternativeRoutes: routes.slice(1).map(candidate => ({ routeId: candidate.routeId, completeness: candidate.completeness, note: candidate.note })),
    missingParams,
    bindings,
    datasets,
    fields,
    relationships,
    joins,
    templates,
  };
}

// Bounded textual rendering of a retrieval bundle for prompts and traces.
export function renderRetrieval(bundle, { maxChars = 3200 } = {}) {
  const lines = [];
  if (bundle.route) {
    const route = bundle.route;
    lines.push(`Route ${route.routeId} (intent ${route.intent}, evidence completeness: ${route.completeness})${route.note ? ` — ${route.note}` : ''}`);
    lines.push(`Required params: ${route.requiredParams.join(', ') || 'none'} | Optional: ${route.optionalParams.join(', ') || 'none'} | Missing: ${bundle.missingParams.join(', ') || 'none'}`);
    if (bundle.alternativeRoutes.length) lines.push(`Alternative routes: ${bundle.alternativeRoutes.map(alt => `${alt.routeId} (${alt.completeness})`).join('; ')}`);
  } else {
    lines.push(`No route in the catalog supports intent '${bundle.intent}'.`);
  }
  for (const dataset of bundle.datasets) {
    lines.push(`Dataset ${dataset.datasetId}: index ${dataset.index || 'unknown'}, granularity ${dataset.granularity}, coverage ${dataset.coverage}${dataset.timeField ? `, time field ${dataset.timeField}` : ''}`);
  }
  if (bundle.fields.length) {
    lines.push(`Fields (ids are the only field references allowed in plans):`);
    for (const field of bundle.fields) {
      lines.push(`- ${field.fieldId} :: ${field.datasetId}.${field.name} (${field.type}${field.keyword ? ', exact-match' : ', full-text only'}${field.nested ? `, nested under ${field.nested}` : ''})${field.role ? ` [role ${field.role}]` : ''}`);
    }
  }
  if (bundle.joins.length) {
    lines.push(`Verified joins: ${bundle.joins.map(join => `${join.source} == ${join.target} @ ${join.granularity || 'document'} (${join.confidence})`).join('; ')}`);
  }
  for (const template of bundle.templates) {
    lines.push(`Template ${template.templateId} (${template.transport}${template.validated ? ', validated' : ''}): ${template.description}`);
  }
  return lines.join('\n').slice(0, maxChars);
}
