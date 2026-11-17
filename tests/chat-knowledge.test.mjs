// Knowledge-base tests: the verified OpenSearch knowledge under
// server/chat/knowledge/ must load without the raw discovery files, contain
// only facts that appear in the captured discovery responses (ground truth =
// opensearch-discovery/raw/context*.txt), reject invented fields and
// arguments, and inject only question-relevant material.
// The raw discovery files are read here as test fixtures only; nothing in the
// runtime path reads them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadKnowledge, isKnownField, validateTemplateArgs, renderTemplate,
  selectKnowledge, findTemplate, KNOWLEDGE_DIR, SNAPSHOT_DATE,
} from '../server/chat/knowledge.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(REPO, 'opensearch-discovery', 'raw');
const raw = name => readFile(path.join(RAW, name), 'utf8');

// Extract aggregation bucket keys from the captured response of one query.
// The aggregation name also appears in request DSL, so pick the occurrence
// that is followed by a buckets array (the response).
function aggKeys(text, aggName, pattern) {
  const needle = `"${aggName}"`;
  let start = -1;
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) {
    if (text.slice(index, index + 200).includes('"buckets"')) { start = index; break; }
  }
  assert.ok(start > 0, `aggregation ${aggName} present in raw capture`);
  return [...text.slice(start, start + 6000).matchAll(pattern)].map(match => match[1]);
}

test('knowledge loads from the knowledge directory alone; raw discovery files are not a runtime dependency', async () => {
  const knowledge = await loadKnowledge();
  assert.equal(knowledge.ok, true);
  assert.ok(knowledge.registry.index_families.length > 0);
  assert.ok(knowledge.templates.templates.length > 0);
  assert.ok(knowledge.context.length > 0);
  assert.equal(knowledge.registry.snapshot.captured_at, SNAPSHOT_DATE);

  const isolated = await mkdtemp(path.join(tmpdir(), 'ib-knowledge-'));
  try {
    await cp(KNOWLEDGE_DIR, isolated, { recursive: true });
    const copy = await loadKnowledge(isolated);
    assert.equal(copy.ok, true, 'loading works with no raw/ directory anywhere near it');
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }

  const missing = await loadKnowledge(path.join(tmpdir(), 'ib-knowledge-does-not-exist'));
  assert.equal(missing.ok, false);
  const fallback = selectKnowledge(missing, 'What is the latest IB?');
  assert.equal(fallback.needsDiscovery, true);
  assert.match(fallback.text, /ListIndexTool/);
  assert.match(fallback.text, /IndexMappingTool/);
});

test('injected knowledge text never leaks raw discovery files or local paths', async () => {
  const knowledge = await loadKnowledge();
  for (const question of [
    'Which RelVals failed in CMSSW_20_1_X_2026-11-16-2300?',
    'Which unit tests failed in the latest CMSSW_20_1_X IB?',
    'Is the Jenkins queue blocked today?',
  ]) {
    const { text } = selectKnowledge(knowledge, question);
    assert.doesNotMatch(text, /context[1-4]\.txt/, 'no raw file names');
    assert.doesNotMatch(text, /opensearch-discovery/, 'no raw directory paths');
    assert.doesNotMatch(text, /\/home\/|\/Users\/|C:\\/, 'no local filesystem paths');
    assert.doesNotMatch(text, /Authorization|Bearer|password|secret/i, 'no credentials');
  }
});

test('registry facts are exactly what the captured discovery responses show', async () => {
  const knowledge = await loadKnowledge();
  const registry = knowledge.registry;
  const [c3, c4] = await Promise.all([raw('context3.txt'), raw('context4.txt')]);

  // Exit codes: the registry's observed values must be the exact bucket-key
  // set of the verified exit-code aggregation (context3 query 13).
  const rawExitcodes = new Set(aggKeys(c3, 'exit_codes', /"key":\s*(\d+)/g).map(Number));
  const registryExitcodes = new Set(registry.fields.exitcode.observed_values);
  assert.ok(rawExitcodes.size > 0);
  for (const value of registryExitcodes) assert.ok(rawExitcodes.has(value), `exitcode ${value} appears in raw buckets`);
  for (const value of rawExitcodes) assert.ok(registryExitcodes.has(value), `raw exitcode ${value} recorded in registry`);
  assert.equal(registry.fields.exitcode.queryable_as, 'integer');
  assert.match(registry.fields.exitcode.semantics, /0 means the step succeeded/);

  // Architectures: every recorded value appears in the raw aggregation.
  const rawArches = new Set(aggKeys(c3, 'architectures', /"key":\s*"([a-z0-9]+_[a-z0-9]+_[a-z0-9]+)"/g));
  assert.ok(rawArches.size >= 20);
  for (const arch of registry.architectures_observed.values) {
    assert.ok(rawArches.has(arch), `architecture ${arch} appears in raw capture`);
  }

  // The verified failure snapshot of query 22 is replayed verbatim.
  for (const fragment of ['"key": "el9_amd64_gcc14"', '"doc_count": 12', '"key": "el9_aarch64_gcc14"',
    '"key": "el8_amd64_gcc14"', '38634.422', '38551.85']) {
    assert.ok(c4.includes(fragment), `failure snapshot fragment ${fragment} in context4.txt`);
  }

  // Release naming facts come from the capture as well.
  assert.ok(c3.includes('CMSSW_20_1_X_2026-11-16-2300') || c4.includes('CMSSW_20_1_X_2026-11-16-2300'));
  assert.match(registry.release_naming.grammar, /CMSSW_<major>_<minor>/);
});

test('every registry fact carries provenance and uncertainty is declared', async () => {
  const { registry } = await loadKnowledge();
  for (const [name, field] of Object.entries(registry.fields)) {
    assert.ok(field.provenance, `field ${name} has provenance`);
    assert.ok(field.confidence, `field ${name} declares confidence`);
  }
  for (const family of registry.index_families) assert.ok(family.provenance, `family ${family.family} has provenance`);
  for (const pitfall of registry.query_pitfalls) assert.ok(pitfall.provenance && pitfall.confidence);
  assert.ok(registry.unverified.length > 0);
  assert.ok(registry.unverified.some(line => /mapping/i.test(line)), 'uncaptured mappings stay declared UNVERIFIED');
  // Documented query traps must be present: they are what the warm-up saves.
  const pitfallIds = new Set(registry.query_pitfalls.map(pitfall => pitfall.id));
  for (const id of ['lexicographic-release-sort', 'hits-total-capped', 'errors-array-capped',
    'errors-on-success', 'exception-missing-on-failures', 'metrics-mixed-types',
    'live-ingestion-count-drift', 'size-limit', 'double-generation-wildcard']) {
    assert.ok(pitfallIds.has(id), `pitfall ${id} documented`);
  }
});

test('unknown and invented fields are rejected; verified fields pass', async () => {
  const knowledge = await loadKnowledge();
  for (const field of ['release', 'architecture', 'workflow', 'step', 'exitcode', '@timestamp',
    '_index', 'error_count', 'exception', 'AvgEventTime', 'HEAP_USED_BYTES',
    'LargestRssEvent-f-RSS', 'LargeVsizeIncreaseEventL2-a-COUNT']) {
    assert.equal(isKnownField(knowledge, field), true, `${field} is known`);
  }
  for (const field of ['release_name', 'exit_code', 'workflowID', 'arch', 'duration_seconds',
    'error_count_max', 'MinEventTimeMillis', 'unit_test', 'tests_status', 'unknown_field']) {
    assert.equal(isKnownField(knowledge, field), false, `${field} is not known`);
  }

  // The no-invented-fields gate: a template parameter may only bind to a
  // registry field.
  const doctored = params => ({ ...knowledge, templates: { ...knowledge.templates,
    templates: [{ id: 'doctored', params, body: { query: { term: { x: '${f}' } } } }] } });
  const bad = validateTemplateArgs(doctored({ f: { type: 'string', field: 'made_up_field' } }), 'doctored', { f: 'value' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('; '), /targets unknown field 'made_up_field'/);
  const good = validateTemplateArgs(doctored({ f: { type: 'string', field: 'exitcode' } }), 'doctored', { f: 'value' });
  assert.equal(good.ok, true);
});

test('template arguments are type-checked, bounded and complete', async () => {
  const knowledge = await loadKnowledge();

  assert.equal(validateTemplateArgs(knowledge, 'no-such-template', {}).ok, false,
    'unknown templates are rejected');

  const defaults = validateTemplateArgs(knowledge, 'release_doc_counts', {});
  assert.equal(defaults.ok, true);
  assert.equal(defaults.values.size, 200, 'declared defaults are applied');

  const coerced = validateTemplateArgs(knowledge, 'release_doc_counts', { size: '50' });
  assert.equal(coerced.ok, true);
  assert.equal(coerced.values.size, 50, 'numeric strings are coerced to integers');

  assert.match(validateTemplateArgs(knowledge, 'release_doc_counts', { size: 5 }).errors.join('; '), /must be >= 10/);
  assert.match(validateTemplateArgs(knowledge, 'release_doc_counts', { size: 2000 }).errors.join('; '), /must be <= 1000/);
  assert.match(validateTemplateArgs(knowledge, 'release_doc_counts', { size: 10.5 }).errors.join('; '), /must be an integer/);
  assert.match(validateTemplateArgs(knowledge, 'failed_steps', { size: 0 }).errors.join('; '), /must be >= 1/);

  assert.match(validateTemplateArgs(knowledge, 'failed_steps', { release: 'nope' }).errors.join('; '), /does not match/);
  assert.match(validateTemplateArgs(knowledge, 'latest_release_for_cycle', { cycle: 'CMSSW_20_1' }).errors.join('; '), /does not match/);
  assert.match(validateTemplateArgs(knowledge, 'failure_distribution_by_arch', {}).errors.join('; '), /Missing required argument 'release'/);
  assert.match(validateTemplateArgs(knowledge, 'failed_steps', { release: 'CMSSW_20_1_X_2026-11-16-2300', foo: 1 }).errors.join('; '), /Unknown argument 'foo'/);

  const optional = validateTemplateArgs(knowledge, 'failed_steps',
    { release: 'CMSSW_20_1_X_2026-11-16-2300', architecture: 'el9_amd64_gcc14', workflow: '38634.422' });
  assert.equal(optional.ok, true);
  assert.equal(validateTemplateArgs(knowledge, 'exitcode_distribution', {}).ok, true,
    'optional parameters may be omitted');
});

test('renderTemplate substitutes parameters and drops clauses of unsupplied optional parameters', async () => {
  const knowledge = await loadKnowledge();
  const release = 'CMSSW_20_1_X_2026-11-16-2300';

  const scoped = renderTemplate(knowledge, 'exitcode_distribution', { release });
  assert.equal(scoped.ok, true);
  assert.deepEqual(scoped.body.query.bool.filter, [{ term: { release } }]);
  assert.equal(scoped.body.aggs.exit_codes.terms.size, 50);

  const open = renderTemplate(knowledge, 'exitcode_distribution', {});
  assert.equal(open.ok, true);
  assert.deepEqual(open.body.query.bool.filter, [], 'no empty term filters are emitted');
  assert.ok(!JSON.stringify(open.body).includes('"release"'), 'unsupplied release leaves no clause behind');

  const failed = renderTemplate(knowledge, 'failed_steps', { release });
  assert.equal(failed.ok, true);
  const filters = failed.body.query.bool.filter;
  assert.deepEqual(filters, [{ exists: { field: 'exitcode' } }, { term: { release } }],
    'architecture/workflow clauses are dropped when not supplied');
  assert.deepEqual(failed.body.query.bool.must_not, [{ term: { exitcode: 0 } }]);
  assert.deepEqual(failed.body._source, { excludes: ['command'] });
  assert.equal(failed.body.size, 10);

  const counts = renderTemplate(knowledge, 'release_doc_counts', {});
  assert.equal(counts.body.aggs.releases.terms.size, 200);
  assert.deepEqual(counts.body.aggs.releases.terms.order, { _key: 'desc' });

  const dist = renderTemplate(knowledge, 'failure_distribution_by_arch', { release });
  assert.equal(dist.ok, true);
  assert.equal(dist.body.aggs.architectures.terms.field, 'architecture');
  assert.equal(dist.body.aggs.architectures.aggs.workflows.terms.field, 'workflow');
});

test('query templates lint: exact-match clauses only target exact-match fields, and unverified clauses are flagged', async () => {
  const knowledge = await loadKnowledge();
  const registry = knowledge.registry;
  const exactable = new Set(['keyword', 'integer']);

  const scan = body => {
    const found = { term: [], terms: [], exists: [], range: [], sort: [], excludes: [], placeholders: [] };
    const walk = node => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === 'string') {
        for (const match of node.matchAll(/\$\{(\w+)\}/g)) found.placeholders.push(match[1]);
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'term' && value && typeof value === 'object') found.term.push(...Object.keys(value));
        else if (key === 'terms' && value && typeof value === 'object' && 'field' in value) found.terms.push(value.field);
        else if (key === 'exists' && value?.field) found.exists.push(value.field);
        else if (key === 'range' && value && typeof value === 'object') found.range.push(...Object.keys(value));
        else if (key === 'sort' && Array.isArray(value)) for (const entry of value) found.sort.push(...Object.keys(entry));
        else if (key === 'excludes' && Array.isArray(value)) found.excludes.push(...value);
        walk(value);
      }
    };
    walk(body);
    return found;
  };

  const verifiedFamily = registry.index_families.find(family => family.documents_verified);
  assert.equal(verifiedFamily.family, 'cmssdt-ib-matrix');

  for (const template of knowledge.templates.templates) {
    assert.equal(template.index, 'cmssdt-ib-matrix-*',
      `template ${template.id} queries only the document-verified family`);
    assert.ok(template.provenance || template.gap, `template ${template.id} has provenance or names a gap`);
    const declared = new Set(Object.keys(template.params || {}));
    const body = template.body;
    if (!body) { assert.ok(template.body_template, `template ${template.id} without body names one`); continue; }
    const found = scan(body);
    for (const name of found.placeholders) {
      assert.ok(declared.has(name), `template ${template.id} placeholder \${${name}} is a declared parameter`);
    }
    for (const field of [...found.term, ...found.terms]) {
      const spec = registry.fields[field];
      assert.ok(spec, `template ${template.id} field ${field} exists in the registry`);
      assert.ok(exactable.has(spec.queryable_as),
        `template ${template.id} exact-matches ${field} which is queryable as ${spec.queryable_as}`);
    }
    for (const field of found.exists) {
      const spec = registry.fields[field];
      assert.ok(spec, `template ${template.id} exists-field ${field} exists in the registry`);
      assert.ok(spec.verified_clauses?.includes('exists'),
        `template ${template.id} exists() on ${field} was verified in discovery`);
    }
    for (const field of [...found.sort, ...found.range]) {
      const spec = registry.fields[field];
      assert.ok(spec, `template ${template.id} sorts/ranges ${field} which exists in the registry`);
      const covered = spec.verified_clauses?.some(clause => clause.startsWith('sort') || clause === 'range');
      if (!covered) {
        assert.equal(template.verified_clauses_complete, false,
          `template ${template.id} must be flagged incomplete when it uses unverified clause on ${field}`);
        assert.ok(template.gap || /UNVERIFIED/.test(template.optional_clause_note || ''),
          `template ${template.id} documents the unverified clause on ${field}`);
      }
    }
    for (const field of found.excludes) {
      assert.ok(isKnownField(knowledge, field), `template ${template.id} excludes known field ${field}`);
    }
    if (template.verified_clauses_complete === true) {
      assert.ok(template.provenance, `verified template ${template.id} keeps its provenance`);
    }
  }
});

test('only question-relevant knowledge is injected, with discovery flagged where it is missing', async () => {
  const knowledge = await loadKnowledge();

  const relval = selectKnowledge(knowledge, 'Which RelVals failed in CMSSW_20_1_X_2026-11-16-2300?');
  assert.equal(relval.ok, true);
  assert.equal(relval.needsDiscovery, false);
  assert.ok(relval.families.includes('cmssdt-ib-matrix'));
  assert.match(relval.text, /cmssdt-ib-matrix/);
  assert.match(relval.text, /exitcode/);
  assert.match(relval.text, /failed_steps/);
  assert.match(relval.text, /VERIFIED STRUCTURAL KNOWLEDGE/);
  assert.match(relval.text, /NOT query results/);
  assert.doesNotMatch(relval.text, /UNIT TESTS:/, 'no unit-test noise in a RelVal answer');

  const unit = selectKnowledge(knowledge, 'Which unit tests failed in the latest CMSSW_20_1_X IB?');
  assert.equal(unit.needsDiscovery, true);
  assert.match(unit.text, /UNIT TESTS:/);
  assert.match(unit.text, /G10/);

  const jenkins = selectKnowledge(knowledge, 'Is the Jenkins queue blocked today?');
  assert.ok(jenkins.families.includes('cmssdt-jenkins-jobs'));
  assert.equal(jenkins.needsDiscovery, true, 'unverified families must trigger discovery');
  assert.match(jenkins.text, /IndexMappingTool before querying/);

  const metrics = selectKnowledge(knowledge, 'Compare memory and timing metrics of CMSSW_20_1_X_2026-11-16-2300');
  assert.match(metrics.text, /numbers|numeric/);
  assert.match(metrics.text, /MinEventTime/);

  const bounded = selectKnowledge(knowledge, 'Which RelVals failed in CMSSW_20_1_X_2026-11-16-2300?', { budget: 600 });
  assert.ok(bounded.text.length <= 600 + 20, `selection respects its budget (${bounded.text.length})`);

  assert.ok(findTemplate(knowledge, 'failed_steps'));
  assert.equal(findTemplate(knowledge, 'missing-template'), null);
});
