# Chat replay evaluation (offline)

Compares two workflows over the same fixtures, with no live OpenSearch and no
live model calls:

- **baseline** — the existing plain tool loop (`ListIndexTool` →
  `IndexMappingTool` → `SearchIndexTool` → answer) driven by a scripted model
  stand-in.
- **graph** — the ROUTE → QUERY → ANSWER pipeline over the versioned CMSSDT
  knowledge graph (`server/chat/graph/`, `server/chat/skills/`), with the same
  scripted model standing in for Kimi.

The scripted models in `mock-model.mjs` encode each workflow's *behavior
contract* so the harness can measure the pipeline around them (routing, plan
validity, tool calls, answer content). They are not the model under test.
**All measured latency is mocked transport/model timing** and every record
carries `latencyLabel: "mocked-transport-and-mock-model"`.

## Running

```bash
# dev set (the iteration set)
node server/chat/eval/run-eval.mjs --suite dev

# held-out set — reserved for the final comparison; do not tune on it
node server/chat/eval/run-eval.mjs --suite held-out --out /tmp/heldout-run

# both suites, both workflows
node server/chat/eval/run-eval.mjs --suite all

# one workflow only
node server/chat/eval/run-eval.mjs --suite dev --mode graph
```

Output: `OUT/report.json` (summary + per-case checks/metrics/traces) and
`OUT/traces/<case>-<mode>.json` per run. `npm run eval:chat` is the same entry
point. `npm run test:chat` includes `tests/chat-eval.test.mjs`, which asserts
the key behaviors (graph passes all cases, baseline shows the measured gaps).

## Case sets

- `cases.mjs → devCases` — per-test failures for a specified IB+architecture,
  latest IB, comparisons, RelVal failures and aggregation (PPL), Jenkins
  questions, missing per-test details, ambiguous requests, zero results,
  failed queries, model-produced plans, conversation parameter resolution,
  and unsupported routes.
- `cases.mjs → heldOutCases` — different questions and values over the same
  categories. Held out during development; used once for the final comparison.
- The failed-unit-tests question appears twice by design: `full` has per-test
  records, `aggregate-only` has aggregate counts only.

Fixture sets live in `fixtures/sets/<name>/` (`data.json`, optional
`errors.json` for missing/closed/unauthorized indices, optional
`catalog-overrides.json` for per-set catalog facts such as coverage).

## Metrics (per case, per workflow)

| metric | meaning | unevaluable when |
|---|---|---|
| `routeFirstAttempt` | routing decision + route id correct on the first pipeline pass | workflow has no routing stage (baseline) |
| `fieldAccuracy` | recall of the question's query-shaping fields (filters/sort/aggs) over the fields actually issued | case has no query (clarify/unsupported) |
| `validPlan` | a plan compiled and executed without plan-level rejection | workflow has no plan stage (baseline) |
| `answerCorrect` | all answer checks pass: identifiers verbatim, source citations, completeness distinctions (zero matches vs missing details vs failed query vs incomplete coverage), time-scope labeling, abstentions | — |
| `toolCalls` | read-only tool invocations | — |
| `latencyMs` | wall clock — **mocked** (label in every record) | — |

Stages a workflow does not have are reported as `unevaluable`/`n/a`, never
guessed. Per-case checks are identical for both workflows.

## Validating and replaying the real catalog

When `opensearch-knowledge/catalog.json` (or its split `catalog/` directory)
is published:

```bash
node server/chat/eval/run-eval.mjs --catalog /path/to/opensearch-knowledge/catalog.json --suite all
```

This **validates** the catalog against the v1 contract
(`schema_version, snapshot, datasets, fields, relationships, routes,
templates`; single-file or split-directory, `id`/`field_id` aliases tolerated,
cross-references checked strictly) and then replays every case in **structural
mode**: routing decisions and plan validation against the real graph, with
**no query execution** and no fixture-data answer checks. The report
(`OUT/report-real.json`) lists per case: decision, route id, intent, plan
validity, clarification asked, and — for blocked routes — the exact missing
evidence/capability. Cases whose expectations depend on synthetic values are
only checked at the intent/decision level.

To replay *with* data once the real indices are reachable, run the deployed
chatbot entry point with `CHAT_GRAPH_PATH` pointing at the catalog and ask the
case questions; the same evidence-bundle classification applies. This harness
stays offline by design.

## Re-running and iterating

1. Change retrieval/prompt modules (`server/chat/skills/prompts/` — bump the
   version, e.g. `route.v2.mjs`, selected with `CHAT_PROMPT_VERSION`) or
   validation in `server/chat/skills/query.mjs`.
2. Re-run `--suite dev` and inspect `OUT/traces/` for failures.
3. Keep `--suite held-out` for the final comparison only.

Process note for the recorded run below: the first held-out run surfaced a
defect (flavoured cycle ids like `CMSSW_20_1_CLANG_X` lost their `_X` suffix in
parameter extraction). The defect was fixed in `skills/route.mjs`, and the
numbers below are from the single re-run after that fix.

## Recorded results (synthetic fixtures)

```
graph:    21/21 cases pass | route 1.00 | fields 1.00 | plans 1.00 | answers 1.00 | tool calls 1.2
baseline:  3/21 cases pass | route n/a | fields 0.71 | plans n/a | answers 0.24 | tool calls 3.1
latency: mocked-transport-and-mock-model for both workflows
```

The baseline's failures are the measured workflow differences: no source
citations or query-scope reporting, no time scope for "latest" questions, empty
per-test exports read as "no failures", no clarification on ambiguous requests,
no abstention when evidence is missing. Model fine-tuning is deliberately out
of scope: remaining repeatable errors after retrieval/prompt/validation work is
where it would be considered.

## Files

| file | role |
|---|---|
| `cases.mjs` | dev + held-out case definitions (questions, expectations, patches) |
| `replay.mjs` | case execution (both workflows), grading, suite aggregation, real-catalog structural replay |
| `run-eval.mjs` | CLI: suite/mode selection, report + trace output |
| `fixture-store.mjs` | deterministic DSL + PPL evaluation over fixture documents, mock MCP/PPL adapters |
| `mock-model.mjs` | scripted model stand-ins (graph contract, legacy plain-loop contract) |
| `fixtures/catalog.v1.json` | synthetic v1-contract catalog (replaced by the real catalog via `--catalog`) |
| `fixtures/sets/` | fixture data sets with per-set error/coverage configuration |
