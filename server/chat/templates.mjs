// Reusable, parameterized OpenSearch query templates for common IB
// investigations. A template only renders when every logical field role it
// needs is bound to a real field of a verified live mapping (see registry.mjs)
// and the rendered arguments pass validation against the *discovered*
// SearchIndexTool input schema. Tool-input validation (Ajv against the MCP
// schema) is separate from OpenSearch DSL validation: a rendered DSL is proven
// only when a real query succeeds, after which the registry marks it validated
// for that mapping fingerprint. Templates never embed credentials or store
// result payloads.
import Ajv from 'ajv';

// Flavour naming convention (domain guide): DEFAULT is encoded as `X`.
export function flavourSuffix(flavour) {
  if (!flavour) return undefined;
  const key = flavour.toUpperCase();
  if (key === 'DEFAULT') return 'X';
  return key.endsWith('_X') ? key : `${key}_X`;
}

export function extractParams(question = '') {
  const text = String(question);
  const params = {};
  const release = /\bCMSSW_\d+_\d+_[A-Z0-9]+(?:_[A-Z0-9]+)*_\d{4}-\d{2}-\d{2}-\d{4}\b/.exec(text);
  if (release) params.release = release[0];
  // No trailing \b: series are usually embedded in longer tokens such as
  // `CMSSW_20_1_X` or `CMSSW_20_1_X_2026-11-16-2300`.
  const series = /\bCMSSW[_ ](\d{1,2})[._](\d{1,2})/i.exec(text) || /\b(\d{2})[._](\d{1,2})(?![0-9])/i.exec(text);
  if (series) params.series = `${series[1]}_${series[2]}`;
  const flavour = /\b(DEFAULT|CLANG|ASAN|UBSAN|ROOT642|ROCm|ARM)\b/i.exec(text);
  if (flavour) params.flavour = flavour[1].toUpperCase();
  const arch = /\b(?:el\d|slc\d|cs\d|fc\d)[a-z0-9]*_(?:amd64|aarch64|x86_64|ppc64le|arm64)_[a-z0-9]+\b/i.exec(text);
  if (arch) params.arch = arch[0].toLowerCase();
  const workflow = /\b(?:workflow|wf)\s*#?\s*(\d{3,5}(?:\.\d+)?)\b/i.exec(text);
  if (workflow) params.workflow = workflow[1];
  return params;
}

// Deterministic question → intent mapping.
export function detectIntent(question = '') {
  const text = String(question).toLowerCase();
  const has = pattern => pattern.test(text);
  if (has(/\bcompare\b|\bvs\b|\bversus\b|difference between/) && has(/flavour|flavor|clang|asan|ubsan|root642|default/)) return 'compare-flavours';
  if (has(/previous|prior|last (?:two|2)|compared? (?:to|with) (?:the )?(?:previous|last)|since yesterday/)) return 'compare-builds';
  if (has(/unit ?tests?|utests?/)) return 'unit-test-failures';
  if (has(/relval|workflow/)) {
    if (has(/aggregate|per workflow|group|count|which workflows|most/)) return 'relval-failure-aggregation';
    return 'failing-relvals';
  }
  // Status questions about the latest build are status questions first:
  // "Is the latest build completed?" is not a "find the latest IB" query.
  if (has(/status|completed|finished|still (?:running|building)|is .*(?:done|complete)/)) return 'build-status';
  if (has(/latest|newest|most recent/)) return 'latest-ib';
  return 'generic';
}

// Exact-match filtering is only sound on keyword (or date/number) fields.
const exactOk = (specs, name) => {
  const spec = specs?.[name];
  return Boolean(spec && (spec.keyword === true || ['date', 'integer', 'long', 'double', 'float', 'boolean'].includes(spec.type)));
};
const seriesFilter = (fields, specs, params) => {
  if (params.release && exactOk(specs, fields.release)) return { term: { [fields.release]: params.release } };
  if (params.series && exactOk(specs, fields.release)) {
    return { prefix: { [fields.release]: `CMSSW_${params.series}_${params.flavour ? `${flavourSuffix(params.flavour)}_` : ''}` } };
  }
  return null;
};
const archFilter = (fields, specs, params) => params.arch && exactOk(specs, fields.arch) ? { term: { [fields.arch]: params.arch } } : null;
const compact = (...items) => items.filter(Boolean);
const failureFilter = fields => {
  if (fields.exitcode) return { bool: { must_not: [{ term: { [fields.exitcode]: 0 } }] } };
  if (fields.passed) return { term: { [fields.passed]: false } };
  return null;
};

// Each template lists the field roles it needs and builds a bounded query.
// `build` returns null when the bound roles or parameters cannot produce a
// sound query; the planner then falls back to model-driven discovery.
export const TEMPLATES = [
  {
    id: 'latest-ib', title: 'Find the latest IB for a release series', needs: ['release', 'timestamp'], familyHint: 'build',
    build({ fields, specs, params }) {
      const filter = compact(seriesFilter(fields, specs, params), archFilter(fields, specs, params));
      if (!filter.length) return null;
      return { size: 5, sort: [{ [fields.timestamp]: 'desc' }], query: { bool: { filter } },
        _source: compact(fields.release, fields.queue, fields.timestamp, fields.arch, fields.status, fields.done) };
    },
  },
  {
    id: 'release-arch-match', title: 'Find exact release and architecture matches', needs: ['release', 'arch'], familyHint: 'build',
    build({ fields, specs, params }) {
      const filter = compact(seriesFilter(fields, specs, params), archFilter(fields, specs, params));
      if (!filter.length || !params.arch) return null;
      return { size: 20, sort: fields.timestamp ? [{ [fields.timestamp]: 'desc' }] : undefined,
        query: { bool: { filter } },
        _source: compact(fields.release, fields.arch, fields.timestamp, fields.status, fields.done, fields.passed) };
    },
  },
  {
    id: 'failing-relvals', title: 'Identify failing RelVals', needs: ['release', 'exitcode'], familyHint: 'relval',
    build({ fields, specs, params }) {
      const failure = failureFilter(fields);
      const workflowFilter = params.workflow && fields.workflowId ? { term: { [fields.workflowId]: /^\d+$/.test(params.workflow) ? Number(params.workflow) : params.workflow } } : null;
      const filter = compact(seriesFilter(fields, specs, params), archFilter(fields, specs, params), workflowFilter, failure);
      if (!failure || !filter.length) return null;
      return { size: 50, sort: fields.timestamp ? [{ [fields.timestamp]: 'desc' }] : undefined,
        query: { bool: { filter } },
        _source: compact(fields.release, fields.arch, fields.workflow, fields.workflowId, fields.exitcode, fields.status, fields.timestamp) };
    },
  },
  {
    id: 'relval-failure-aggregation', title: 'Aggregate failures by workflow', needs: ['release', 'timestamp'], familyHint: 'relval',
    build({ fields, specs, params }) {
      const failure = failureFilter(fields);
      const groupField = [fields.workflowId, fields.workflow].find(name => name && exactOk(specs, name));
      if (!failure || !groupField) return null;
      return { size: 0, query: { bool: { filter: compact(seriesFilter(fields, specs, params), archFilter(fields, specs, params), failure) } },
        aggs: { by_workflow: { terms: { field: groupField, size: 20 },
          ...(fields.timestamp ? { aggs: { latest: { max: { field: fields.timestamp } } } } : {}) } } };
    },
  },
  {
    id: 'compare-flavours', title: 'Compare flavours', needs: ['queue', 'timestamp'], familyHint: 'build',
    build({ fields, specs, params }) {
      if (!params.series || !exactOk(specs, fields.queue)) return null;
      return { size: 0, query: { bool: { filter: compact(archFilter(fields, specs, params), { prefix: { [fields.queue]: `CMSSW_${params.series}_` } }) } },
        aggs: { by_flavour: { terms: { field: fields.queue, size: 12 },
          aggs: { latest_build: { top_hits: { size: 1, sort: [{ [fields.timestamp]: 'desc' }],
            _source: compact(fields.release, fields.queue, fields.timestamp, fields.arch, fields.status, fields.done) } } } } } };
    },
  },
  {
    id: 'compare-builds', title: 'Compare the latest and the previous build', needs: ['release', 'timestamp'], familyHint: 'build',
    build({ fields, specs, params }) {
      const filter = compact(seriesFilter(fields, specs, params), archFilter(fields, specs, params));
      if (!filter.length) return null;
      return { size: 2, sort: [{ [fields.timestamp]: 'desc' }], query: { bool: { filter } },
        _source: compact(fields.release, fields.queue, fields.timestamp, fields.arch, fields.status, fields.done, fields.passed) };
    },
  },
  {
    id: 'unit-test-failures', title: 'Summarize unit-test failures', needs: ['release'], familyHint: 'unit',
    build({ fields, specs, params }) {
      const failure = failureFilter(fields);
      const filter = compact(seriesFilter(fields, specs, params), archFilter(fields, specs, params), failure);
      if (!failure || !filter.length) return null;
      return { size: 50, sort: fields.timestamp ? [{ [fields.timestamp]: 'desc' }] : undefined,
        query: { bool: { filter } },
        _source: compact(fields.release, fields.arch, fields.test, fields.package, fields.exitcode, fields.status, fields.timestamp) };
    },
  },
  {
    id: 'build-status', title: 'Identify build status and completion', needs: ['release'], familyHint: 'build',
    build({ fields, specs, params }) {
      const filter = compact(seriesFilter(fields, specs, params), archFilter(fields, specs, params));
      if (!filter.length) return null;
      return { size: 10, sort: fields.timestamp ? [{ [fields.timestamp]: 'desc' }] : undefined,
        query: { bool: { filter } },
        _source: compact(fields.release, fields.queue, fields.arch, fields.timestamp, fields.status, fields.done, fields.passed) };
    },
  },
];

const BODY_KEYS = ['body', 'searchBody', 'requestBody', 'dsl', 'searchQuery'];
const PART_KEYS = ['size', 'from', 'sort', '_source', 'aggs', 'aggregations', 'track_total_hits'];

// Map a rendered search body onto the *discovered* SearchIndexTool input
// schema. Returns null when the schema cannot be satisfied confidently: the
// agent then falls back to model-driven queries instead of guessing arguments.
export function buildSearchArgs(schema, { index, body }) {
  const properties = schema?.properties || {};
  const args = {};
  if (properties.index) args.index = index;
  const bodyKey = BODY_KEYS.find(key => properties[key]);
  if (bodyKey) args[bodyKey] = body;
  else if (properties.query) {
    args.query = body.query;
    for (const key of PART_KEYS) {
      if (!properties[key] || body[key] === undefined) continue;
      args[key === '_source' && properties.source && !properties._source ? 'source' : key] = body[key];
    }
    if (body.aggs && properties.aggregations && !properties.aggs) { args.aggregations = body.aggs; delete args.aggs; }
    if (body._source && properties.source && !properties._source) args.source = body._source;
  } else return null;
  if (schema?.required && !schema.required.every(key => args[key] !== undefined)) return null;
  if (schema?.additionalProperties === false) {
    const allowed = new Set(Object.keys(properties));
    if (Object.keys(args).some(key => !allowed.has(key))) return null;
  }
  return args;
};

const ajv = new Ajv({ strict: false, allErrors: true });
export function validateToolArguments(schema, args) {
  let validate;
  try { validate = ajv.compile(schema || { type: 'object' }); } catch { return { ok: false, errors: ['tool schema cannot be compiled'] }; }
  const ok = validate(args);
  return { ok, errors: ok ? [] : (validate.errors || []).map(error => `${error.instancePath || '(root)'} ${error.message}`) };
}

// Render a template against a registry family and validate the tool input.
export function renderTemplate(template, { family, params, searchSchema }) {
  const fields = family?.roles || {};
  if (!template.needs.every(role => fields[role])) return null;
  const body = template.build({ fields, specs: family.fields || {}, params });
  if (!body) return null;
  const args = buildSearchArgs(searchSchema, { index: family.pattern, body });
  if (!args) return null;
  const validation = validateToolArguments(searchSchema, args);
  if (!validation.ok) return null;
  return { templateId: template.id, title: template.title, index: family.pattern, body, args, description: `${template.title} on ${family.pattern}` };
}
