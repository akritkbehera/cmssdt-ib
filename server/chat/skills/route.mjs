// ROUTE skill (v1): turn a user question into a typed intent plus typed
// parameters, then resolve the route against the versioned knowledge graph.
//
// Deterministic and replayable: parameter extraction is regex-based, route
// selection is contract-driven (graph/retrieval.mjs), and the clarification
// policy asks exactly one focused question when a missing parameter changes
// the result. When the catalog has no supported route — or every candidate
// route is blocked by declared data gaps — the skill reports the missing
// evidence or capability instead of guessing. Parameters are resolved from the
// current question first, then from the conversation (clearly sourced).
import { retrieve, rankRoutes } from '../graph/retrieval.mjs';

export const INTENTS = [
  'unit_test_failures',
  'relval_failures',
  'relval_failure_aggregation',
  'latest_ib',
  'compare_builds',
  'compare_flavours',
  'build_status',
  'jenkins_jobs',
  'generic',
];

// Typed parameter shapes accepted by routes/templates.
export const PARAM_TYPES = {
  build: 'string',          // exact IB identifier, e.g. CMSSW_20_1_X_2026-11-16-2300
  series: 'string',         // release cycle, e.g. CMSSW_20_1_X
  architecture: 'string',   // e.g. el9_amd64_gcc14
  flavour: 'string',        // e.g. DEFAULT, CLANG
  time_window: 'date_range', // { from?, to?, preset? }
  compare_with: 'string',   // 'previous' | build id | 'flavour:CLANG' | 'arch:el8_...'
  workflow: 'string',       // RelVal workflow id
};

export const BUILD_RE = /\bCMSSW_[0-9]+_[0-9]+(?:_[A-Z0-9]+)?_X_[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}\b/;
export const BUILD_PARTS_RE = /^CMSSW_([0-9]{1,2})_([0-9]{1,2})(?:_([A-Z0-9]+))?_X_([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4})$/;
export const SERIES_RE = /\bCMSSW[_ ]([0-9]{1,2})[._]([0-9]{1,2})(?:_([A-Z0-9]+))?_?X?\b/i;
const ARCH_BODY = '(?:el[0-9]|slc[0-9]|cs[0-9]|fc[0-9])[a-z0-9]*_(?:amd64|aarch64|x86_64|ppc64le|arm64)_[a-z0-9]+';
export const ARCH_RE = new RegExp(`\\b${ARCH_BODY}\\b`, 'i');
export const FLAVOURS = ['DEFAULT', 'CLANG', 'ASAN', 'UBSAN', 'ROOT642', 'ROCm', 'ARM'];

const isoDate = '([0-9]{4}-[0-9]{2}-[0-9]{2})';

function extractTimeWindow(text) {
  const last = /\b(?:last|past|previous)\s+([0-9]+)\s*(hours?|h|days?|d|weeks?|w)\b/i.exec(text);
  if (last) return { preset: `last-${last[1]}-${last[2].replace(/s$/, '').replace(/^(h|hour)$/i, 'hours').replace(/^(d|day)$/i, 'days').replace(/^(w|week)$/i, 'weeks')}` };
  const between = new RegExp(`\\bbetween\\s+${isoDate}\\s+and\\s+${isoDate}`, 'i').exec(text);
  if (between) return { from: between[1], to: between[2] };
  const fromTo = new RegExp(`\\bfrom\\s+${isoDate}\\s+to\\s+${isoDate}`, 'i').exec(text);
  if (fromTo) return { from: fromTo[1], to: fromTo[2] };
  const since = new RegExp(`\\bsince\\s+${isoDate}`, 'i').exec(text);
  if (since) return { from: since[1] };
  const until = new RegExp(`\\b(?:until|before|up to)\\s+${isoDate}`, 'i').exec(text);
  if (until) return { to: until[1] };
  const on = new RegExp(`\\bon\\s+${isoDate}`, 'i').exec(text);
  if (on) return { from: on[1], to: on[1] };
  return null;
}

function extractCompareWith(text) {
  const build = new RegExp(`(?:vs\\.?|versus|compared? to|against)\\s+(${BUILD_RE.source.replace(/^\\b/, '').replace(/\\b$/, '')})`, 'i').exec(text);
  if (build) return build[1];
  const flavour = new RegExp(`(?:vs\\.?|versus|compared? to|against)\\s+\\b(${FLAVOURS.join('|')})\\b`, 'i').exec(text);
  if (flavour) return `flavour:${flavour[1].toUpperCase()}`;
  const arch = new RegExp(`(?:vs\\.?|versus|compared? to|against)\\s+(${ARCH_BODY})`, 'i').exec(text);
  if (arch) return `arch:${arch[1].toLowerCase()}`;
  if (/\b(previous|prior|last\s+(?:two|2|few)|earlier)\b/i.test(text) && /\b(compare|vs|versus|change|differs?|delta|than)\b/i.test(text)) return 'previous';
  return null;
}

// Typed parameter extraction. Returns parameters with provenance so the
// clarification policy can distinguish "absent" from "stale conversation value".
export function extractParams(question, { source = 'question' } = {}) {
  const text = String(question || '');
  const params = {};
  const set = (name, value) => { if (value !== null && value !== undefined && params[name] === undefined) params[name] = { value, source }; };

  const build = BUILD_RE.exec(text);
  set('build', build ? build[0] : null);
  const series = SERIES_RE.exec(text);
  if (series) {
    const flavourBit = (series[3] || '').toUpperCase();
    set('series', `CMSSW_${series[1]}_${series[2]}${flavourBit && flavourBit !== 'X' ? `_${flavourBit}` : '_X'}`);
    if (flavourBit && flavourBit !== 'X') set('flavour', flavourBit);
    set('series_prefix', `CMSSW_${series[1]}_${series[2]}_`);
  }
  if (build) {
    const parts = BUILD_PARTS_RE.exec(build[0]);
    if (parts) {
      set('flavour', (parts[3] || 'DEFAULT').toUpperCase());
      // A named build implies its release cycle: deriving it keeps required
      // `series` satisfied without a needless clarification.
      set('series', `CMSSW_${parts[1]}_${parts[2]}${parts[3] ? `_${parts[3]}` : '_X'}`);
      set('series_prefix', `CMSSW_${parts[1]}_${parts[2]}_`);
    }
  }
  const flavourWord = new RegExp(`\\b(${FLAVOURS.join('|')})\\b`, 'i').exec(text);
  if (flavourWord) set('flavour', flavourWord[1].toUpperCase());
  const arch = ARCH_RE.exec(text);
  set('architecture', arch ? arch[0].toLowerCase() : null);
  const window = extractTimeWindow(text);
  if (window) set('time_window', window);
  const compare = extractCompareWith(text);
  if (compare) set('compare_with', compare);
  const workflow = /\b(?:workflow|wf)\s*#?\s*([0-9]{3,5}(?:\.[0-9]+)?)\b/i.exec(text);
  set('workflow', workflow ? workflow[1] : null);
  return params;
}

// Resolve parameters across the whole conversation: the current question wins,
// earlier turns only fill gaps. Returns plain values plus a provenance map.
export function resolveParams(question, conversation = []) {
  const fromQuestion = extractParams(question, { source: 'question' });
  const merged = { ...fromQuestion };
  const earlier = [];
  for (const message of conversation.slice(0, -1)) {
    if (!message?.content) continue;
    earlier.push(extractParams(message.content, { source: 'conversation' }));
  }
  for (const params of earlier.reverse()) {
    for (const [name, entry] of Object.entries(params)) if (merged[name] === undefined) merged[name] = entry;
  }
  const values = {}, sources = {};
  for (const [name, entry] of Object.entries(merged)) { values[name] = entry.value; sources[name] = entry.source; }
  return { params: values, sources };
}

// Deterministic question → typed intent. Comparisons are recognized before
// their component topics so "compare the unit tests of A and B" is a
// comparison; aggregate questions ("how many failures per workflow") are
// distinguished from detail questions ("which workflows failed").
export function detectIntent(question) {
  const text = String(question || '').toLowerCase();
  const has = pattern => pattern.test(text);
  const detail = /\b(which|what|list|names?|per[- ]test|each test|show .*(tests?|failures))\b/;
  const aggregate = /\b(how many|count|number of|total|per workflow|group|aggregate|distribution|most)\b/;

  if ((has(/\bcompare\b|\bvs\.?\b|\bversus\b|difference between|differs?\b|\bdelta\b/) ||
      (has(/\bprevious\b|\bprior\b|\blast (?:two|2)\b/) && has(/\bthan\b|\bchange\b|compar/))) &&
      (has(/flavour|flavor|clang|asan|ubsan|root642|default|gcc/) && !has(/relval|workflow|unit ?test/))) return 'compare_flavours';
  if (has(/\bcompare\b|\bvs\.?\b|\bversus\b|difference between|compared? (?:to|with)|\bprevious\b.*\b(latest|current)|\bsince yesterday\b/)) {
    return has(/relval|workflow/) ? 'relval_failures' : has(/unit ?test|utest/) ? 'unit_test_failures' : 'compare_builds';
  }
  if (has(/\bjenkins\b|\bjob\b|\bqueue\b|\bci\b/)) return 'jenkins_jobs';
  if (has(/relval|workflow/)) return aggregate.test(text) && !detail.test(text) ? 'relval_failure_aggregation' : 'relval_failures';
  if (has(/unit ?tests?|utests?/)) return 'unit_test_failures';
  if (has(/status|completed|finished|still (?:running|building)|is .*(?:done|complete)/)) return 'build_status';
  if (has(/latest|newest|most recent/)) return 'latest_ib';
  return 'generic';
}

export function wantsPerTestDetail(question) {
  return /\b(which|what|names?|per[- ]test|each test|individual)\b/i.test(String(question || ''));
}
export function wantsAggregateOnly(question) {
  return !wantsPerTestDetail(question) && /\b(how many|count|number of|total|aggregate|summary|summarize)\b/i.test(String(question || ''));
}

// Declared blockers that actually hold given the datasets in scope. Only
// conditions named in route.blockedWhen are evaluated: a route is never
// blocked by conditions the catalog does not declare.
export function evaluateBlockers(route, catalog) {
  const datasetById = new Map(catalog.datasets.map(dataset => [dataset.datasetId, dataset]));
  const active = [];
  for (const condition of route.blockedWhen || []) {
    if (condition === 'dataset_coverage_aggregate_only') {
      const hit = route.datasets.map(id => datasetById.get(id)).filter(Boolean).find(dataset => dataset.coverage === 'aggregate_only');
      if (hit) active.push({ code: condition, detail: `dataset '${hit.datasetId}' has aggregate-only coverage` });
    } else if (condition === 'dataset_missing') {
      const hit = route.datasets.map(id => datasetById.get(id)).filter(Boolean).find(dataset => !dataset.index || dataset.coverage === 'absent');
      if (hit) active.push({ code: condition, detail: `dataset '${hit.datasetId}' has no queryable index` });
    }
  }
  return active;
}

// One focused clarification question for the first result-changing missing
// parameter. Order follows the route's own declared requirement order.
const CLARIFICATION_ASKS = {
  build: 'Which IB or release build should I look at (for example CMSSW_20_1_X_2026-11-16-2300), or which release cycle (for example CMSSW_20_1_X)?',
  series: 'Which release cycle should I look at (for example CMSSW_20_1_X)?',
  architecture: 'Which architecture should I filter on (for example el9_amd64_gcc14)?',
  flavour: 'Which build flavour do you mean (DEFAULT, CLANG, ASAN, …)?',
  time_window: 'Which time window should I cover (for example "last 24 hours" or "since 2026-11-01")?',
  compare_with: 'What should the comparison target be — the previous build, a specific build, or another flavour?',
  workflow: 'Which RelVal workflow id should I look at (for example 11634.0)?',
};

export function routeQuestion({ question, conversation = [], catalog, preferCompleteness = null }) {
  const intent = detectIntent(question);
  const { params, sources } = resolveParams(question, conversation);
  const prefer = preferCompleteness
    ?? (wantsAggregateOnly(question) ? 'aggregate_only' : wantsPerTestDetail(question) ? 'per_test' : null);
  const candidates = rankRoutes(catalog, intent);

  if (!candidates.length) {
    return {
      decision: 'unsupported', intent, params, sources, routeId: null,
      unsupported: {
        reason: 'no_route',
        detail: `The catalog has no route for intent '${intent}'.`,
        needs: [
          `a route entry with intent '${intent}' naming the datasets and evidence fields that answer it`,
          ...nearestRouteHelp(catalog, intent),
        ],
      },
    };
  }

  // Walk candidates in rank order: prefer a complete route unless blockers
  // declared by the catalog apply; fall back to a lower-completeness route.
  const attempts = [];
  for (const candidate of candidates) {
    const scoped = retrieve(catalog, { intent, params, preferCompleteness: prefer, routeId: candidate.routeId });
    const blockers = evaluateBlockers(candidate, catalog);
    attempts.push({ routeId: candidate.routeId, blockers, missingParams: scoped.missingParams });
    if (blockers.length) continue;
    if (scoped.missingParams.length) {
      const askFor = scoped.missingParams[0];
      return {
        decision: 'clarify', intent, params, sources, routeId: candidate.routeId,
        bundle: scoped,
        clarification: { param: askFor, question: CLARIFICATION_ASKS[askFor] || `Which value of '${askFor}' should I use?` },
        attempts,
      };
    }
    return { decision: 'answer', intent, params, sources, routeId: candidate.routeId, bundle: scoped, attempts };
  }

  const blocked = attempts.filter(attempt => attempt.blockers.length);
  return {
    decision: 'unsupported', intent, params, sources, routeId: null,
    unsupported: {
      reason: 'route_blocked',
      detail: blocked.map(attempt => `${attempt.routeId}: ${attempt.blockers.map(blocker => blocker.detail).join('; ')}`).join(' | '),
      needs: blocked.flatMap(attempt => attempt.blockers.map(blocker => `data with ${blocker.code} resolved for ${attempt.routeId}`)),
    },
    attempts,
  };
}

function nearestRouteHelp(catalog, intent) {
  const topics = String(intent).split('_');
  const near = catalog.routes
    .map(route => ({ route, score: route.intent.split('_').filter(word => topics.includes(word)).length }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.route.routeId.localeCompare(b.route.routeId))
    .slice(0, 2);
  return near.map(entry => `closest supported route: ${entry.route.routeId} (intent ${entry.route.intent})`);
}
