# Direct PPL in IB Insights

The existing model configured by `CERN_AI_MODEL` (including Kimi) receives four
tools: the three dynamically discovered native MCP read tools plus the local
`execute_opensearch_ppl` function. No model, MCP tool or MCP server is registered
in OpenSearch. No inference provider, browser history, login or frontend changes
are required. The existing streamed tool-result/answer loop handles both paths.

Native MCP remains the route for `ListIndexTool`, `IndexMappingTool` and
`SearchIndexTool`. The additional local function sends JSON `{ "query": "..." }`
to `POST https://os-cmssdt.cern.ch/os/_plugins/_ppl`. Use discovery/mappings to
find a concrete open index and field types before analytics. Do not assume the
generation suffix or that unit-test records describe full-build timings.

## Authentication and deployment

PPL receives the same authenticated runtime configuration as MCP. Kerberos uses
curl/GSSAPI and the existing dedicated cache, CA trust and network path; JavaScript
does not read ticket contents. Bearer mode forwards only the existing OpenSearch
headers to the same origin and supports the existing one-time refresh callback.
The CERN AI Gateway key is used only for inference. Credentials stay server-side.

Frontend requests still require the existing backend authentication. An operator
CLI test can use the dedicated Kerberos cache without a browser login. In the
current shared Kerberos deployment, OpenSearch sees the service ticket's identity,
not each chat user's identity. Use a dedicated least-privilege identity with only
PPL execution and reads on approved monitoring indices. Application validation
is defense in depth, not a substitute for OpenSearch permissions (including
permissions on alias targets).

This change is prepared on `direct-ppl-execution`; no production deployment or
cluster settings/registrations are changed by the implementation or tests.

## Supported grammar and limits

This is a deliberately restricted PPL grammar, parsed before any request:

- One `source = concrete-index`, optionally preceded by `search`; backticks
  around the source name are accepted. No source wildcards or index lists.
- `where` with field/literal comparisons, AND/OR/NOT, parentheses, IN lists,
  and IS [NOT] NULL. Strings use single quotes without escapes; use DSL for
  values requiring escaped quotes/backslashes.
- `stats count()/count(field)/sum(field)/avg(field)/min(field)/max(field)`,
  optional aliases and `by` fields.
- `fields` with explicit field names, `sort` with optional prefix +/- per field,
  and a terminal positive `head` count no greater than the requested output cap.
  A user-specified `head` before another stage is rejected so aggregations cannot
  accidentally count a pre-limited document sample.
- No subqueries, joins, comments, semicolons, remote sources, eval, script,
  output/write commands, arbitrary functions, or unconsumed syntax.

Default approved families are `cmssdt-ib-matrix-*`, `cmssdt-ibs-*`,
`cmssdt-ib-dataset-*`, `cmssdt-jenkins-jobs-*`, `cmssdt-jenkins-ibs-*`,
`cmssdt-relvals_stats_summary-*`, and `cmssdt-externals_stats_summary-*`.
Each execution still requires one concrete index. System/security index names
cannot pass validation. Unsupported PPL is rejected, never rewritten to appear safe.

Requests are limited to 8,000 query characters, 1,500 tokens, 12 pipeline stages,
16 levels of filter nesting, two concurrent PPL executions and 30 executions per
minute per backend process. This complements the existing four-chat concurrency
limit; multiple replicas would each have a separate budget.

A trailing `head` caps output at 100 rows or the tool's smaller `max_rows` value.
It is added **after** aggregation, not before: a count still counts all matching
documents. Output includes `schema`, `datarows`, `returnedRows`, `rowLimit`,
`limitReached`, `truncated`, `total` and retrieval time. Reaching the row limit
does not establish a complete list of groups. `total` must not be interpreted
as the source-document count for an aggregate; read the count cell itself.
Responses over 128 KiB fail rather than silently returning partial evidence.
Credential-shaped result strings are scrubbed before the model sees them.

The request has a maximum 30-second network/body deadline and respects chat
cancellation. Aborting the client does not guarantee cluster-side cancellation;
the cluster owner should configure an appropriate `plugins.ppl.query.timeout`
and resource controls. This implementation does not change that cluster setting.

## Configuration

| Variable | Default / constraint |
| --- | --- |
| `CHAT_PPL_ENABLED` | `true`; `false` removes the local tool from model requests |
| `OPENSEARCH_PPL_URL` | Sibling `/_plugins/_ppl` on the configured MCP origin/base path; alternate origins/routes rejected |
| `CHAT_PPL_ALLOWED_INDICES` | Comma-separated concrete `cmssdt-` names or family prefixes ending in one `*` |
| `CHAT_PPL_TIMEOUT_MS` | `30000`; range 1000–30000 |
| `CHAT_PPL_MAX_BYTES` | `131072`; range 1024–131072 |

No new secret is required. Existing deployment defaults work without new
environment variables. For overrides, pass the variables to the backend process
or container; repository/environment variables alone do not enter the existing
container unless its deployment workflow explicitly forwards them.

## Verification

Run `npm run test:chat` and `npm run build:pages`. Tests cover the restricted
grammar and bypass attempts, tool schema, authentication forwarding, Kerberos
endpoint binding, expired-token refresh, errors, row/byte caps, deadline and
cancellation, admission budgets and one model using all four tools.

The live test is opt-in and not enabled by CI:

```bash
CHAT_PPL_LIVE_TEST=1 \
CHAT_PPL_LIVE_INDEX=cmssdt-externals_stats_summary-2968 \
node --env-file-if-exists=.env.chat --test tests/chat-ppl.test.mjs
```

That CLI test needs existing service headers or the dedicated Kerberos cache.
For service token-file verification or an OIDC+Kerberos container, the operator
can instead run the bundled checker, once this code is installed there:

```bash
node --env-file-if-exists=.env.chat server/chat/check-ppl.mjs \
  cmssdt-externals_stats_summary-2968
```

For per-user OIDC bearer mode, sign in to the chat and ask:
“How many records are in cmssdt-externals_stats_summary-2968?”
The expected tool query is:

```text
source = cmssdt-externals_stats_summary-2968 | stats count() as total
```

The handoff verified 1,748 records on 17 November 2026. This is historical
evidence, not a permanent assertion: the live count can change. No live CERN
claim is made from mocked tests.

## References

- [OpenSearch 3.9 PPL syntax](https://docs.opensearch.org/3.9/sql-and-ppl/ppl/commands/syntax/)
- [SQL/PPL API](https://docs.opensearch.org/3.9/sql-and-ppl/sql-ppl-api/)
- [PPL settings and cluster timeout](https://docs.opensearch.org/3.9/sql-and-ppl/settings/)
