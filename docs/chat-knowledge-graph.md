# Knowledge-graph chat skills (ROUTE / QUERY / ANSWER)

The IB Insights chatbot can answer through three reusable skills driven by a
versioned CMSSDT knowledge graph (the `opensearch-knowledge` catalog), instead
of relying entirely on the plain discover-then-search tool loop.

## What is where

| path | role |
|---|---|
| `server/chat/graph/catalog.mjs` | versioned catalog loader (v1 contract: `schema_version, snapshot, datasets, fields, relationships, routes, templates`; single file or split `catalog/*.json`) |
| `server/chat/graph/retrieval.mjs` | compact deterministic retrieval by intent, params, dataset, related field ids; returns evidence + mapping verification context |
| `server/chat/graph/pipeline.mjs` | ROUTE → QUERY → ANSWER orchestration with bounded retries, structured tool-call transcript, and plain-loop fallback |
| `server/chat/skills/route.mjs` | intent + parameter extraction (build, architecture, flavour, time window, comparison target) from question and conversation; one focused clarification when a missing parameter changes the result |
| `server/chat/skills/query.mjs` | validated parameterized templates first, else structured model plan referencing dataset/field ids, compiled and validated in code (read-only, bounded) |
| `server/chat/skills/answer.mjs` | compact evidence bundle + completeness distinctions (zero matching failures / export with incomplete coverage / missing per-test details / failed query) with citations and time-scope labeling |
| `server/chat/skills/prompts/` | versioned prompt files (`route.v1`, `query.v1`, `answer.v1`, `index.v1`), loadable independently of any dev skills |

All query execution reuses the existing read-only paths: `SearchIndexTool`
through `server/chat/tool-runtime.mjs` and the fail-closed PPL validator in
`server/chat/ppl.mjs`. Nothing in the graph path runs outside those controls.

## Configuration

| env | meaning | default |
|---|---|---|
| `CHAT_GRAPH_PATH` | `catalog.json` file or split `catalog/` directory | — (graph path disabled) |
| `CHAT_GRAPH` | `1`/`true` to enable the graph path when a catalog is loaded | `1` |
| `CHAT_PROMPT_VERSION` | prompt bundle version (`v1`) | `v1` |

Startup logs report whether the graph loaded (`graph enabled: ...`), the chat
health endpoint reports it under `knowledgeGraph`, and every response carries a
`trace_id` resolving to the full structured record (intent, route, params and
their provenance, plan attempts, tool calls, evidence status, prompt version).
When the catalog is absent or the question falls outside known routes, the
existing plain loop answers exactly as before.

## Answer semantics

Answers cite their source datasets and filters, distinguish "zero matching
failures in the queried scope" from "per-test details are missing / the export
has incomplete coverage / the query failed", and state the time scope of the
data used for "latest" questions. Build identifiers, architectures, statuses
and test names are preserved verbatim.

## Replay evaluation (offline)

`server/chat/eval/` compares the existing workflow against the graph-guided
one on synthetic fixtures — dev and held-out case sets, dual unit-test fixtures
(per-test records vs aggregate-only counts), mocked MCP and model calls, no
live OpenSearch. See `server/chat/eval/README.md` for metrics, how to run
(`npm run eval:chat`), and how to validate and replay the real catalog once
`opensearch-knowledge/catalog.json` is published:

```bash
node server/chat/eval/run-eval.mjs --catalog /path/to/opensearch-knowledge/catalog.json --suite all
```
