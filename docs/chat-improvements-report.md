> Historical report: registry/planner/context injection and its synthetic benchmark are no longer part of the live chatbot. See ib-insights.md for current behavior.

# IB Insights chat backend — resilience, diagnostics and agent memory

This report collects the deliverables of the investigation-and-hardening work on
`server/chat/` and the Insights frontend. Everything below was implemented in
the dev repository and verified by tests run locally (Node 22/24). Nothing was
deployed to production and no production credentials, SSO settings or live
permissions were touched.

## 1. Root-cause analysis

### Confirmed (traced in code, reproduced by tests)

1. **All failures looked identical.** `publicError()` mapped only 401/403/timeouts
   to distinct messages and collapsed everything else — MCP session-expiry 404s,
   5xx/429, socket resets and JSON-RPC `McpError`s (-32001/-32000/-32602/-32603)
   — into the misleading "Could not connect to OpenSearch MCP…".
   → `server/chat/errors.mjs` classifies every failure into a real category
   (authentication, authorization, timeout, cancelled, session, protocol,
   invalid_arguments, http_transient, http_client, transport, unknown), each
   with its own public code and message. Verified by
   `tests/chat-mcp-resilience.test.mjs` (10 tests) and
   `tests/chat-security.test.mjs`.
2. **No recovery path.** A broken/expired MCP session or one transient 503 ended
   the investigation; credentials were only refreshed at request start.
   → `server/chat/mcp.mjs` adds bounded retries (exponential backoff + jitter,
   abort-aware), single-shot session reinitialize, and forced credential renewal
   (OIDC `authRefresh`) before reconnecting. Retries never run for auth or
   invalid-argument failures, and a retry re-runs only the failed operation —
   never the investigation. Mid-run transport failure, session-expiry, 401
   refresh-and-reinit, and bounded-failure cases are all tested.
3. **Timeout and cancellation were conflated** (single `controller.abort()`).
   → `server/chat/index.mjs` aborts with distinct reasons (`TimeoutError` vs
   `AbortError`); `classifyError` trusts `signal.reason` first, because the MCP
   SDK wraps both as `McpError(-32001)`.
4. **Discovery churn.** Every question re-ran `tools/list` and the system prompt
   mandated mapping discovery before answering, producing a large number of
   redundant MCP/OpenSearch calls and vague-Ajv retry loops.
   → persistent registry + tool-schema cache (fingerprints, TTL), 8
   parameterized query templates executed as verified evidence before the model
   runs, per-investigation query dedupe, and detailed Ajv error feedback naming
   the exact schema mismatch. Measured in the benchmark (§3).
5. **"Hi recap" behaviour.** The frontend auto-selected the most recent thread
   and re-sent its full history, so a greeting in a fresh visit resumed an old
   investigation. The server is stateless per request (confirmed).
   → `src/Components/Insights/InsightsPage.js` remembers the active conversation
   per browser tab (`sessionStorage`): reload continues the tab's own thread
   (browser tests keep passing), a fresh visit starts a new conversation.
6. **No persistence volume.** Schema knowledge was rediscovered per request and
   lost on restart.
   → `server/chat/registry.mjs` + `CHAT_DATA_DIR` mounted volume (atomic writes,
   `.bak`, corruption quarantine, v1→v2 migration, in-memory fallback on
   read-only volumes). Verified by `tests/chat-registry.test.mjs` (8 tests).

### Hypotheses (not yet field-confirmed)

- CERN proxy / token-exchange edge cases (timeouts on the OIDC exchange, header
  quirks) may add failure modes not reproducible against mocks.
- Mapping drift frequency on the live cluster determines how often template
  validation goes stale (currently fingerprint + 24 h TTL).
- The magnitude of Ajv-retry-loop savings depends on the model; measured here
  with a deterministic scripted model only.

## 2. Architecture

- `server/chat/errors.mjs` — classification + public error mapping (compat:
  unknown errors keep the legacy "Could not connect" wording expected by
  existing clients/tests).
- `server/chat/diagnostics.mjs` — one sanitized JSON line per MCP operation
  (stage, tool, duration, outcome, HTTP status, error kind/code, retry attempt,
  correlation ID, successful tool-call count). Scrubs bearer tokens, Basic
  auth, JWTs, cookies, API keys and credential URLs; never logs query bodies or
  results.
- `server/chat/mcp.mjs` — `openMcp` (fresh client+transport per attempt),
  `runWithRecovery`, `createMcpSession` (reinit + `authRefresh`), `wrapMcpClient`,
  `createToolCache` (fingerprints, TTL, per-session instances).
- `server/chat/registry.mjs` — persistent schema registry (index families, field
  types, keyword-vs-text, date formats, nested paths, bound roles, tool schemas,
  fingerprints, timestamps, TTLs, template validation state). Atomic save +
  quarantine; works without a volume.
- `server/chat/templates.mjs` — 8 templates (latest IB, release/arch match,
  failing RelVals, RelVal failure aggregation, compare flavours, compare builds,
  unit-test failures, build status). A template renders only when every field
  role binds to a verified live mapping and the rendered tool input validates
  against the *discovered* `SearchIndexTool` schema; otherwise the planner
  returns nothing and the model explores. Flavour convention (DEFAULT → `X`)
  from `src/Utils/processing.js` is encoded in `flavourSuffix`.
- `server/chat/context.mjs` + `server/chat/planner.mjs` — deterministic,
  budgeted context block (relevant families, bound roles, domain-guide
  conventions, matched templates, investigation state) and query-plan execution
  with dedupe and validation recording.
- `server/chat/knowledge/domain-guide.md` — version-controlled domain guide
  (release/IB naming, index families, exitcode 0 = passed, field-role
  conventions) used in context construction.
- `server/chat/knowledge.mjs` + `knowledge/*.json|md` — verified static
  discovery snapshot (2026-11-17) with provenance under
  `opensearch-discovery/raw/`; structural metadata only, loader self-contained.
- `server/chat/agent.mjs` — session init, cached-vs-fresh discovery, planner
  evidence injection, registry learning (`recordObservation`), dedupe, detailed
  validation feedback, secret-scrubbed tool results, greeting/no-recap rule in
  the system prompt, `CHAT_OPTIMIZE` toggle.
- Frontend: `src/Components/Insights/InsightsPage.js` (tab-scoped active
  conversation). Server remains stateless per request.

## 3. Benchmark (real numbers from `tests/chat-benchmark.test.mjs`)

Scripted model + mock MCP server, 6 representative questions, deterministic:
baseline (`CHAT_OPTIMIZE=false` behaviour: fresh `tools/list` + index/mapping
discovery per question, one guessed-index failure per question) vs improved
pipeline cold and warm (registry on disk, tool cache in process).

| metric | baseline | improved-cold | improved-warm |
| --- | --- | --- | --- |
| questions completed | 6/6 | 6/6 | 6/6 |
| MCP calls (total) | 30 | 14 | 12 |
| schema discovery (`tools/list`) | 6 | 1 | 0 |
| mapping discovery (List+Mapping) | 12 | 2 | 0 |
| searches (`SearchIndexTool`) | 12 | 11 | 12 |
| failed attempts | 6 | 0 | 0 |
| model calls | 30 | 14 | 12 |
| prompt characters (sum) | 152 451 | 74 596 | 66 448 |
| wall latency (ms) | 90 | 40 | 29 |
| tool-schema cache hit rate | — | 83 % | 100 % |

These are synthetic harness measurements (call counts, prompt size, latency on
one machine) — not live CERN results and not answer-quality measurements. The
test asserts the deterministic counter invariants (completion, call counts,
failed attempts, prompt size, cache reuse) and only reports timings.

## 4. Test results

- `npm run test:chat`: **54/54 pass** — the 16 pre-existing tests
  (`chat-backend`, `chat-auth`, `chat-kerberos`, frontend storage) unchanged and
  green (compat constraints preserved: exact tool call counts, `discoverTools`
  shape, `options.openMcp` overrides, legacy error wording for unknown errors),
  plus 38 new: `chat-mcp-resilience` (10), `chat-registry` (8), `chat-context`
  (8), `chat-security` (11), `chat-benchmark` (1).
- Browser (`tests/browser/chat.mjs`, `chat-auth.mjs`) pass on Chromium and
  Firefox locally against the production build; WebKit's binary is not
  installed locally (CI's Playwright image covers it). Post-reload thread
  continuity, new-conversation isolation, cancellation and responsive checks all
  green with the frontend change.
- `npm run build:pages` succeeds.

Bugs found and fixed by the new tests: series extraction missed
`CMSSW_20_1_X…` tokens (regex word-boundary), status questions misrouted to
`latest-ib`, bare "401/403" errors without a numeric status classified as
unknown, unit-test template family hint missing `utest` naming, plus earlier
phase fixes (recovery return value, transport reuse, nested-field accumulator,
family prefix matching, `.bak` copy path).

## 5. Security review

- **Auth flows untouched**: CERN OIDC token exchange for `itos_cmssdt`,
  service/CLI token (file re-read + signature/issuer/expiry/aud checks), and
  Kerberos all preserved; no credentials, cookies or tokens in logs, registry,
  diagnostics, client code or `VITE_` variables.
- **Read-only**: only `ListIndexTool`, `IndexMappingTool`, `SearchIndexTool` are
  discoverable by the model; rendered templates are index-scoped reads and
  cannot contain scripts or mutations (asserted in tests). Per-user OpenSearch
  authorization always applies — the planner queries run under the requesting
  user's credentials.
- **Isolation**: per-session MCP clients/tokens/tool caches; registry volumes
  per deployment and never contain query results or credentials; conversations
  are isolated (no evidence crossing; asserted in `chat-security.test.mjs`).
- **Sanitization**: tool results and evidence are scrubbed (bearer/Basic tokens,
  JWTs, cookies, API keys, credential URLs) before reaching the model or
  diagnostics; public errors never echo raw upstream text.
- **Container**: read-only filesystem, `--cap-drop ALL`,
  `no-new-privileges`, `--user $(id -u):$(id -g)` in both auth modes (previously
  only Kerberos), no private keys mounted (CA bundle copied to a 644 file),
  three explicit mounts: CA bundle (ro), Kerberos cache (rw, kerberos mode),
  registry data (rw). Rootless Podman uses `--userns keep-id` for writable
  mounts. Never deployed automatically.

## 6. Deployment / configuration changes

- `.github/workflows/deploy-chat.yml`: persistent registry volume
  `$HOME/.local/share/cmssdt-chat/data:/var/lib/cmssdt-chat` with
  `CHAT_DATA_DIR=/var/lib/cmssdt-chat`; `--user $(id -u):$(id -g)` for both
  kerberos and oidc modes; optional `CHAT_OPTIMIZE` repository variable
  (default `true`) for baseline rollback/benchmarks. YAML validated.
- `.env.chat.example`: documents `CHAT_DATA_DIR`, `CHAT_OPTIMIZE`,
  `CHAT_MCP_TIMEOUT_MS`, `CHAT_DIAGNOSTICS`.
- `docs/ib-insights.md`: failure taxonomy, retries, diagnostics, registry and
  templates, context-awareness, frontend thread selection, benchmark, security
  notes and limitations.
- `server/chat/Dockerfile` unchanged (still `USER node`; overridden by the
  workflow's `--user`).

## 7. Limitations

- Benchmark is a scripted workload; live-cluster validation of call reductions
  and of CERN-specific failure modes still needs a field run.
- Template coverage is the 8 documented investigations; other questions fall
  back to model-driven exploration with cached schema knowledge (still fewer
  discovery calls than baseline).
- Registry mapping TTL is 24 h (sweep at 7 days); faster-moving clusters may
  need tuning.
- WebKit browser tests were not run locally (binary missing); CI covers them.
- `server/chat/knowledge.mjs` (verified discovery snapshot loader) is
  self-contained and not yet imported by the agent hot path; it is available as
  provenance-backed structural knowledge.

## 8. Files changed in this phase (working tree)

Modified: `.env.chat.example`, `.github/workflows/deploy-chat.yml`,
`.gitignore`, `docs/ib-insights.md`, `server/chat/planner.mjs`,
`src/Components/Insights/InsightsPage.js`.
New: `tests/chat-benchmark.test.mjs`. Earlier phases' code/tests were committed
in `3c9db14`. All 54 chat tests and the Chromium/Firefox browser checks pass on
this tree.
