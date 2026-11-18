// Replay evaluation case sets.
//
// `dev` is the iteration set: it was used to find and fix problems in the
// retrieval, prompts and validation. `heldOut` is reserved for the final
// comparison and must not be used to tune anything. All cases run offline
// against the synthetic fixture sets; no live OpenSearch or model calls.
//
// Case shape:
//   id           stable identifier (used in traces and the report)
//   set          fixture set name: 'full' | 'aggregate-only' | 'broken'
//   question     the user turn under test
//   conversation earlier turns (may supply parameters)
//   patch        optional (rawCatalog) => rawCatalog mutation, applied before
//                parsing (e.g. removing a route to test abstention)
//   expect       see `evaluateCase` in replay.mjs; fields/answers are graded
//                against BOTH workflows with the same checks
//   notes        why the case exists

export const FIXED_NOW = Date.parse('2026-11-18T02:00:00.000Z');
export const FIXED_RETRIEVED_AT = '2026-11-18T02:00:00.000Z';

export const devCases = [
  {
    id: 'dev-01-per-test-failures',
    set: 'full',
    question: 'Which unit tests failed in CMSSW_20_1_X_2026-11-16-2300 for el8_amd64_gcc12?',
    expect: {
      decision: 'answer', routeId: 'unit-test-failures-per-test', intent: 'unit_test_failures',
      params: { build: 'CMSSW_20_1_X_2026-11-16-2300', architecture: 'el8_amd64_gcc12' },
      evidenceStatus: 'complete',
      fields: ['release_name', 'arch', 'exitcode'],
      answer: {
        contains: ['testCaloParticles', 'testTPGEmulator', 'unit_test_results'],
        notContains: ['testVertexFitter', 'testPileupProducer'],
      },
      maxToolCalls: 8,
    },
    notes: 'Per-test failures for a specified IB + architecture (fixture has per-test records).',
  },
  {
    id: 'dev-02-latest-ib',
    set: 'full',
    question: 'What is the latest IB for CMSSW_20_1_X?',
    expect: {
      decision: 'answer', routeId: 'latest-ib', intent: 'latest_ib',
      params: { series: 'CMSSW_20_1_X' },
      evidenceStatus: 'complete',
      fields: ['release_name', 'ib_date'],
      answer: { contains: ['CMSSW_20_1_X_2026-11-17-2300', 'ib_builds'], statesTimeScope: true },
      maxToolCalls: 6,
    },
    notes: 'Latest IB; the answer must state the time scope of the data used.',
  },
  {
    id: 'dev-03-compare-flavours',
    set: 'full',
    question: 'Compare the latest builds of CMSSW_20_1_X and CMSSW_20_1_CLANG_X flavours.',
    expect: {
      decision: 'answer', routeId: 'compare-flavours', intent: 'compare_flavours',
      params: { series: 'CMSSW_20_1_X' },
      evidenceStatus: 'complete',
      fields: ['release_name', 'release_queue', 'ib_date'],
      answer: { contains: ['CMSSW_20_1_CLANG_X', 'CMSSW_20_1_X'] },
      maxToolCalls: 6,
    },
    notes: 'Comparison across flavours; grouped per release queue.',
  },
  {
    id: 'dev-04-relval-incomplete-coverage',
    set: 'full',
    question: 'Which RelVal workflows failed for CMSSW_20_1_X?',
    expect: {
      decision: 'answer', routeId: 'relval-failures', intent: 'relval_failures',
      params: { series: 'CMSSW_20_1_X' },
      evidenceStatus: 'export_incomplete_coverage',
      fields: ['release_name', 'exitcode'],
      answer: {
        contains: ['11634.0', '13634.0', 'incomplete coverage', 'relval_results'],
        notContains: ['13234.0'],
      },
      maxToolCalls: 6,
    },
    notes: 'RelVal failures from a summary export that declares partial coverage.',
  },
  {
    id: 'dev-05-relval-aggregation-ppl',
    set: 'full',
    question: 'How many RelVal failures are there per workflow for CMSSW_20_1_X?',
    expect: {
      decision: 'answer', routeId: 'relval-failure-aggregation', intent: 'relval_failure_aggregation',
      params: { series: 'CMSSW_20_1_X' },
      evidenceStatus: 'export_incomplete_coverage',
      fields: ['release_queue', 'exitcode', 'workflow'],
      usedPpl: true,
      answer: { contains: ['11634.0', '13634.0'] },
      maxToolCalls: 6,
    },
    notes: 'Bounded PPL aggregation through the existing fail-closed validator.',
  },
  {
    id: 'dev-06-jenkins-jobs',
    set: 'full',
    question: 'Which Jenkins jobs failed recently?',
    expect: {
      decision: 'answer', routeId: 'jenkins-jobs', intent: 'jenkins_jobs',
      evidenceStatus: 'complete',
      fields: ['status'],
      answer: { contains: ['cms-sw-ib-relval', 'FAILURE', 'jenkins_jobs'] },
      maxToolCalls: 6,
    },
    notes: 'Jenkins question with no required parameters.',
  },
  {
    id: 'dev-07-missing-per-test-details',
    set: 'aggregate-only',
    question: 'Which unit tests failed in CMSSW_20_1_X_2026-11-16-2300 for el8_amd64_gcc12?',
    expect: {
      decision: 'answer', routeId: 'unit-test-failures-aggregate', intent: 'unit_test_failures',
      params: { build: 'CMSSW_20_1_X_2026-11-16-2300', architecture: 'el8_amd64_gcc12' },
      evidenceStatus: 'missing_per_test_details',
      fields: ['release_name', 'arch'],
      answer: {
        contains: ['aggregate', 'failed_tests', 'unit_test_summaries'],
        reportsMissingDetail: true,
        notContains: ['No failed unit tests found'],
      },
      maxToolCalls: 8,
    },
    notes: 'Dual fixture B: same question as dev-01 but only aggregate counts exist. The workflow must say per-test details are missing, never "no failures".',
  },
  {
    id: 'dev-08-ambiguous-clarify',
    set: 'full',
    question: 'Which unit tests failed?',
    expect: {
      decision: 'clarify', routeId: 'unit-test-failures-per-test', intent: 'unit_test_failures',
      answer: { asksClarification: true },
      maxToolCalls: 0,
    },
    notes: 'Ambiguous request: no build or cycle. One focused question, no querying.',
  },
  {
    id: 'dev-09-zero-matches',
    set: 'full',
    question: 'Which unit tests failed in CMSSW_20_1_X_2026-11-17-2300 for el8_amd64_gcc12?',
    expect: {
      decision: 'answer', routeId: 'unit-test-failures-per-test', intent: 'unit_test_failures',
      params: { build: 'CMSSW_20_1_X_2026-11-17-2300', architecture: 'el8_amd64_gcc12' },
      evidenceStatus: 'zero_matches',
      fields: ['release_name', 'arch', 'exitcode'],
      answer: {
        contains: ['zero matching', 'nothing'],
        notContains: ['No failed unit tests found'],
      },
      maxToolCalls: 8,
    },
    notes: 'Zero matching failures must be stated as "matched nothing in scope", with the build metadata (context rows) present but not masking the empty answer set.',
  },
  {
    id: 'dev-10-failed-query',
    set: 'broken',
    question: 'Which unit tests failed in CMSSW_20_1_X_2026-11-16-2300 for el8_amd64_gcc12?',
    expect: {
      decision: 'answer', routeId: 'unit-test-failures-per-test', intent: 'unit_test_failures',
      evidenceStatus: 'query_failed',
      answer: {
        reportsFailedQuery: true,
        contains: ['query failed'],
        notContains: ['No failed unit tests found', 'zero matching'],
      },
      maxToolCalls: 8,
    },
    notes: 'Missing index: the workflow must report the failure and infer nothing about the data.',
  },
  {
    id: 'dev-11-model-plan',
    set: 'full',
    question: 'Which unit tests failed in CMSSW_20_1_X_2026-11-16-2300 for el8_amd64_gcc12?',
    // Break the validated template's parameter binding so planning must fall
    // back to a structured model plan that is then validated in code.
    patch: raw => ({
      ...raw,
      templates: raw.templates.map(template => template.template_id === 't-ut-failures'
        ? { ...template,
            params: Object.fromEntries(Object.entries(template.params).map(([name, spec]) => [name === 'build' ? 'build_id' : name, spec])),
            query: { ...template.query, filters: template.query.filters.map(filter => filter.param === 'build' ? { ...filter, param: 'build_id' } : filter) } }
        : template),
    }),
    expect: {
      decision: 'answer', routeId: 'unit-test-failures-per-test', intent: 'unit_test_failures',
      planSource: 'model',
      evidenceStatus: 'complete',
      fields: ['release_name', 'arch', 'exitcode'],
      answer: { contains: ['testCaloParticles', 'testTPGEmulator'], notContains: ['testVertexFitter'] },
      maxToolCalls: 8,
    },
    notes: 'Model-produced structured plan referencing catalog dataset/field ids, validated and compiled in code.',
  },
  {
    id: 'dev-12-conversation-params',
    set: 'full',
    question: 'Which unit tests failed on el8_amd64_gcc12?',
    conversation: [
      { role: 'user', content: 'Investigate CMSSW_20_1_X_2026-11-16-2300 for me.' },
      { role: 'assistant', content: 'Looking at that build now.' },
    ],
    expect: {
      decision: 'answer', routeId: 'unit-test-failures-per-test', intent: 'unit_test_failures',
      params: { build: 'CMSSW_20_1_X_2026-11-16-2300', architecture: 'el8_amd64_gcc12' },
      paramSources: { build: 'conversation' },
      evidenceStatus: 'complete',
      fields: ['release_name', 'arch', 'exitcode'],
      answer: { contains: ['testCaloParticles', 'testTPGEmulator'] },
      maxToolCalls: 8,
    },
    notes: 'Parameters resolved from the conversation with provenance; no needless clarification.',
  },
  {
    id: 'dev-13-unsupported-route',
    set: 'full',
    question: 'Which Jenkins jobs failed recently?',
    // Remove the Jenkins route (and its templates) to exercise the explicit
    // "missing evidence/capability" report instead of a guess.
    patch: raw => ({
      ...raw,
      routes: raw.routes.filter(route => route.route_id !== 'jenkins-jobs'),
      templates: raw.templates.filter(template => template.route_id !== 'jenkins-jobs'),
    }),
    expect: {
      decision: 'unsupported', routeId: null, intent: 'jenkins_jobs',
      answer: { abstains: true, contains: ['Missing evidence'] },
      maxToolCalls: 0,
    },
    notes: 'No supported route: report what is missing, do not fabricate an answer.',
  },
];

export const heldOutCases = [
  {
    id: 'held-01-per-test-el9',
    set: 'full',
    question: 'Which unit tests failed in CMSSW_20_1_X_2026-11-16-2300 for el9_amd64_gcc14?',
    expect: {
      decision: 'answer', routeId: 'unit-test-failures-per-test', intent: 'unit_test_failures',
      params: { build: 'CMSSW_20_1_X_2026-11-16-2300', architecture: 'el9_amd64_gcc14' },
      evidenceStatus: 'complete',
      fields: ['release_name', 'arch', 'exitcode'],
      answer: { contains: ['testPileupProducer', 'unit_test_results'], notContains: ['testHGCalSim', 'testCaloParticles'] },
      maxToolCalls: 8,
    },
    notes: 'Per-test failures, different architecture than dev-01.',
  },
  {
    id: 'held-02-build-status',
    set: 'full',
    question: 'What is the status of the latest CMSSW_20_1_X IB?',
    expect: {
      decision: 'answer', routeId: 'build-status', intent: 'build_status',
      params: { series: 'CMSSW_20_1_X' },
      evidenceStatus: 'complete',
      fields: ['release_name', 'ib_date'],
      answer: { contains: ['running', 'CMSSW_20_1_X_2026-11-17-2300', 'ib_builds'], statesTimeScope: true },
      maxToolCalls: 6,
    },
    notes: 'Build status of the latest IB with time-scope labeling.',
  },
  {
    id: 'held-03-compare-builds',
    set: 'full',
    question: 'Compare the latest two IBs of CMSSW_20_1_X for el8_amd64_gcc12.',
    expect: {
      decision: 'answer', routeId: 'compare-builds', intent: 'compare_builds',
      params: { series: 'CMSSW_20_1_X', architecture: 'el8_amd64_gcc12' },
      evidenceStatus: 'complete',
      fields: ['release_name', 'arch', 'ib_date'],
      answer: { contains: ['CMSSW_20_1_X_2026-11-17-2300', 'CMSSW_20_1_X_2026-11-16-2300'] },
      maxToolCalls: 8,
    },
    notes: 'Comparison target "previous"; the architecture string must not be read as a flavour.',
  },
  {
    id: 'held-04-relval-workflow',
    set: 'full',
    question: 'Did RelVal workflow 11634.0 fail for CMSSW_20_1_X?',
    expect: {
      decision: 'answer', routeId: 'relval-failures', intent: 'relval_failures',
      params: { series: 'CMSSW_20_1_X', workflow: '11634.0' },
      evidenceStatus: 'export_incomplete_coverage',
      fields: ['release_name', 'workflow', 'exitcode'],
      answer: { contains: ['11634.0'], notContains: ['13634.0', '13234.0'] },
      maxToolCalls: 6,
    },
    notes: 'Workflow parameter scoped to a single RelVal workflow id.',
  },
  {
    id: 'held-05-zero-relval-clang',
    set: 'full',
    question: 'Which RelVal workflows failed for CMSSW_20_1_CLANG_X?',
    expect: {
      decision: 'answer', routeId: 'relval-failures', intent: 'relval_failures',
      params: { series: 'CMSSW_20_1_CLANG_X' },
      evidenceStatus: 'zero_matches',
      fields: ['release_name', 'exitcode'],
      answer: { contains: ['zero matching', 'nothing'], notContains: ['No failing RelVals found'] },
      maxToolCalls: 6,
    },
    notes: 'Zero matching failures for a cycle with no RelVal rows.',
  },
  {
    id: 'held-06-jenkins-window',
    set: 'full',
    question: 'Show me Jenkins jobs from the last 3 days.',
    expect: {
      decision: 'answer', routeId: 'jenkins-jobs', intent: 'jenkins_jobs',
      evidenceStatus: 'complete',
      fields: ['timestamp'],
      answer: { contains: ['cms-sw-ib-dist-int', 'jenkins_jobs'] },
      maxToolCalls: 6,
    },
    notes: 'Preset time window resolved against the injected fixed clock.',
  },
  {
    id: 'held-07-missing-details-no-arch',
    set: 'aggregate-only',
    question: 'Which individual unit tests failed in CMSSW_20_1_X_2026-11-16-2300?',
    expect: {
      decision: 'answer', routeId: 'unit-test-failures-aggregate', intent: 'unit_test_failures',
      evidenceStatus: 'missing_per_test_details',
      fields: ['release_name'],
      answer: { contains: ['aggregate', 'failed_tests'], reportsMissingDetail: true, notContains: ['No failed unit tests found'] },
      maxToolCalls: 8,
    },
    notes: 'Dual-fixture case without an architecture filter.',
  },
  {
    id: 'held-08-ambiguous-relval',
    set: 'full',
    question: 'Which RelVal workflows failed?',
    expect: {
      decision: 'clarify', routeId: 'relval-failures', intent: 'relval_failures',
      answer: { asksClarification: true },
      maxToolCalls: 0,
    },
    notes: 'Ambiguous RelVal question: ask for the release cycle.',
  },
];

export const suites = { dev: devCases, 'held-out': heldOutCases };
