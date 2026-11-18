#!/usr/bin/env node
// Replay evaluation CLI.
//
//   node server/chat/eval/run-eval.mjs [--suite dev|held-out|all] [--mode both|graph|baseline]
//                                      [--out DIR] [--catalog PATH]
//
// Without --catalog: runs the offline fixture replay (baseline vs graph) and
// writes OUT/report.json plus OUT/traces/<case>-<mode>.json.
//
// With --catalog PATH (the real opensearch-knowledge catalog.json or its
// directory): validates the catalog and replays the same cases in structural
// mode only — routing and plan validation against the real graph, with NO
// query execution and no fixture-data answer checks. Writes OUT/report-real.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suites, FIXED_NOW, FIXED_RETRIEVED_AT } from './cases.mjs';
import { runSuite, runStructuralCase, LATENCY_LABEL } from './replay.mjs';
import { loadCatalog } from '../graph/catalog.mjs';
import { loadPromptBundle } from '../skills/prompts.mjs';

function parseArgs(argv) {
  const args = { suite: 'dev', mode: 'both', out: join(dirname(fileURLToPath(import.meta.url)), 'out'), catalog: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--suite') args.suite = argv[++i];
    else if (flag === '--mode') args.mode = argv[++i];
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--catalog') args.catalog = argv[++i];
    else if (flag === '--help' || flag === '-h') { args.help = true; }
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

const HELP = `Usage: node server/chat/eval/run-eval.mjs [options]
  --suite dev|held-out|all   case set to run (default: dev; held-out is for the final comparison)
  --mode both|graph|baseline workflows to run (default: both)
  --out DIR                  output directory (default: server/chat/eval/out)
  --catalog PATH             validate + structurally replay against a real catalog.json
                             (offline: no queries are executed)`;

function selectCases(suite) {
  if (suite === 'all') return [...suites.dev, ...suites['held-out']];
  if (suites[suite]) return suites[suite];
  throw new Error(`unknown suite '${suite}' (expected dev|held-out|all)`);
}

function summarize(result) {
  const lines = [`${result.caseId} [${result.mode}] ${result.pass ? 'PASS' : 'FAIL'}`];
  for (const check of result.checks || []) {
    if (!check.pass) lines.push(`  ✗ ${check.name}: ${check.detail}`);
  }
  if (result.error) lines.push(`  ✗ ${result.error}`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  const cases = selectCases(args.suite);
  await mkdir(join(args.out, 'traces'), { recursive: true });

  if (args.catalog) {
    // Real-catalog mode: validate, then structural replay only.
    const loaded = await loadCatalog(args.catalog);
    const prompts = await loadPromptBundle('v1');
    const report = {
      generatedAt: new Date().toISOString(),
      mode: 'real-catalog-structural',
      catalog: { path: args.catalog, ok: loaded.ok, source: loaded.source, errors: loaded.errors, warnings: loaded.warnings,
        schemaVersion: loaded.catalog?.schemaVersion || null, snapshot: loaded.catalog?.snapshot?.id || null,
        datasets: loaded.catalog?.datasets?.map(dataset => dataset.datasetId) || [],
        routes: loaded.catalog?.routes?.map(route => route.routeId) || [] },
      note: 'Offline structural replay: routing + plan validation only. No queries were executed and no fixture-data answer checks apply.',
      clock: { now: FIXED_NOW, retrievedAt: FIXED_RETRIEVED_AT },
      cases: loaded.ok ? await Promise.all(cases.map(kase => runStructuralCase(kase, { catalog: loaded.catalog, prompts }))) : [],
    };
    report.summary = {
      cases: report.cases.length,
      decisionMatches: report.cases.filter(entry => entry.decisionMatches).length,
      intentMatches: report.cases.filter(entry => entry.intentMatches).length,
      plansValid: report.cases.filter(entry => entry.planValid).length,
      plansTotal: report.cases.filter(entry => entry.planValid !== null).length,
      blockedRoutes: report.cases.filter(entry => entry.decision === 'unsupported').map(entry => ({ caseId: entry.caseId, needs: entry.unsupported?.needs || [] })),
      clarifications: report.cases.filter(entry => entry.decision === 'clarify').map(entry => ({ caseId: entry.caseId, asks: entry.clarification?.param || null })),
    };
    await writeFile(join(args.out, 'report-real.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`catalog: ${report.catalog.ok ? 'VALID' : 'INVALID'} (${report.catalog.source})`);
    for (const error of report.catalog.errors) console.log(`  error: ${error}`);
    for (const warning of report.catalog.warnings || []) console.log(`  warning: ${warning}`);
    console.log(`structural replay: ${report.summary.decisionMatches}/${report.summary.cases} decision matches, ${report.summary.plansValid}/${report.summary.plansTotal} plans valid, ${report.summary.blockedRoutes.length} blocked route(s)`);
    console.log(`report: ${join(args.out, 'report-real.json')}`);
    return;
  }

  const modes = args.mode === 'both' ? ['graph', 'baseline'] : [args.mode];
  const suite = await runSuite(cases, { modes });
  suite.suite = args.suite;
  suite.clock = { now: FIXED_NOW, retrievedAt: FIXED_RETRIEVED_AT };

  for (const result of suite.results) {
    await writeFile(join(args.out, 'traces', `${result.caseId}-${result.mode}.json`),
      `${JSON.stringify({ ...result.trace, caseId: result.caseId, mode: result.mode, pass: result.pass, checks: result.checks, metrics: result.metrics }, null, 2)}\n`);
    console.log(summarize(result));
  }
  await writeFile(join(args.out, 'report.json'), `${JSON.stringify(suite, null, 2)}\n`);
  console.log('\nsummary (per workflow):');
  const fmt = (value, digits = 2) => value === null || value === undefined ? 'n/a' : value.toFixed(digits);
  for (const [mode, stats] of Object.entries(suite.summary)) {
    console.log(`  ${mode}: ${stats.casesPassed}/${stats.cases} cases pass | route ${fmt(stats.routeFirstAttemptAccuracy)} | fields ${fmt(stats.fieldAccuracy)} | plans ${fmt(stats.validPlanRate)} | answers ${fmt(stats.answerCorrectRate)} | tool calls ${fmt(stats.avgToolCalls, 1)} | latency ${fmt(stats.avgLatencyMs, 1)}ms (${stats.latencyLabel})`);
  }
  console.log(`report: ${join(args.out, 'report.json')}`);
}

main().catch(error => { console.error(error?.stack || error); process.exit(1); });
