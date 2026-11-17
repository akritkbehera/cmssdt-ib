# IB Insights chat

Open `#/insights`, or use **IB Insights** in the dashboard navigation. The chat route works even if the build data service is unavailable.

The interface uses assistant-ui's local runtime and primitives. Conversations, titles and messages live in IndexedDB under this site's origin. They remain on this browser/device until deleted or site data is cleared. No account or server chat database is required. Requests send the active conversation to the backend; messages are then sent to the CERN model and tool queries to OpenSearch. Switching conversations cancels an active response. A browser storage failure is reported instead of silently falling back to unsaved history.

## Start the backend

Use Node 24 (the version used by CI), then:

```sh
npm ci
cp .env.chat.example .env.chat
# Edit .env.chat with your server-side credentials and endpoints.
npm run chat:server
```

Set `CERN_AI_KEY`, `CERN_AI_MODEL`, and `OPENSEARCH_MCP_URL`. Choose a model available at your CERN gateway that supports streamed OpenAI-compatible tool calls. The gateway defaults to `https://aigw.cern.ch/v1`.

`CERN_AI_TOKEN` is accepted as an alias for `CERN_AI_KEY`. For CERN authentication, audience requirements and deployment steps, follow [CERN authentication setup](cern-authentication.md).

The endpoint defaults to `https://os-cmssdt.cern.ch/os/_plugins/_ml/mcp`. The `/os` prefix is required. A successful request inside Dashboards Dev Tools does not establish access from this backend. Use per-user OIDC login, a newly issued CLI token file, or a dedicated read-only service credential; see the authentication guide. SSO cookies are rejected. CERN model authentication is separate from OpenSearch. Use a trusted CA (`NODE_EXTRA_CA_CERTS` if needed), never disable TLS validation.

Register the existing `ListIndexTool`, `IndexMappingTool` and `SearchIndexTool` with the native MCP server. Only those three names are exposed to the model, with arguments validated against the discovered schemas. The backend creates a Streamable HTTP MCP client per question, discovers/paginates tools, streams the model's response, executes requested tools and continues the model loop. Tool-step, concurrency, context, result-size and request-duration limits keep requests bounded. Actual read permissions and query quotas must be enforced by the OpenSearch identity and cluster policy.

The system prompt asks for exact build identities, mappings before queries, limited searches, comparable architectures, evidence and explicit uncertainty. This does not replace checking model conclusions. Model/provider errors are returned without upstream payloads or credentials. Health reports configuration only. **Test MCP connection** performs real initialization and tool discovery; only success produces the verified status. This verifies MCP access, not model inference; send a question to verify both.

## Local development

Run `npm start` in a second terminal. Vite proxies `/api/chat` to port 8787. Leave **Connection → Backend address** empty. In service mode, enter `CHAT_ACCESS_TOKEN` in Connection if configured. Tokens are held in memory only and cleared on reload. Conversations continue to persist in IndexedDB.

## GitHub Pages deployment

Pages hosts the UI but cannot hold the model key or run this backend. Deploy `server/chat/index.mjs` on a CERN-reachable Node 24 service behind HTTPS. An optional Dockerfile is provided at `server/chat/Dockerfile` (build from repository root). Allow the exact Pages origin in `CHAT_ALLOWED_ORIGINS`. Beyond loopback, service mode requires `CHAT_ACCESS_TOKEN`; OIDC mode requires a registered confidential client and per-user login. Use a least-privilege OpenSearch identity.

Open Connection and enter the backend HTTPS address without `/api/chat`. Only that address is saved in localStorage. Access/session tokens stay in memory. CERN keys and OpenSearch tokens never go into the UI. Alternatively set the GitHub Actions repository variable `CHAT_BACKEND_URL`; the Pages workflow embeds this public address as `VITE_CHAT_BACKEND_URL`. Never put secrets in any `VITE_` variable or Actions variable.

The server binds to localhost by default. It stores no conversations and logs no request bodies. Browser cancellation aborts model and MCP requests. Follow-up context includes the prior user/assistant text; tool responses are used during each investigation and must be queried again when a follow-up needs fresh evidence.

## Verification

```sh
npm run test:chat
npm run build:pages
```

Tests use local model/MCP endpoints and fake IndexedDB. CI runs Chromium, Firefox and WebKit checks for chat persistence, context, OIDC popup messaging, memory-only sessions, logout, cancellation, and mobile layout. These are fixtures, not evidence of live CERN authentication. After deployment, use **Test MCP connection** or `npm run chat:check` in service mode to verify real `tools/list`, then ask a question to test model inference.

## Failure reporting and retries

The backend classifies every failure into a real category instead of a generic message: `authentication` (401/token expiry), `authorization` (403), `timeout`, `cancelled` (browser abort), `session` (expired MCP session), `protocol` (JSON-RPC errors), `invalid_arguments` (tool schema mismatch), `http_transient` (5xx/429), `http_client`, `transport` (reset/refused sockets) and `unknown`. Each category has a distinct public `code` and message; raw upstream payloads and credentials are never echoed to the client.

Only transient failures are retried: bounded exponential backoff with jitter, abort-aware, never for auth or invalid-argument errors, and never replaying an investigation (only the single failed operation is retried). Expired MCP sessions reinitialize exactly once — with forced credential renewal in OIDC mode before reconnecting — and broken transports get a fresh SDK client. Tool-call limits per response and evidence-size caps protect the service.

## Diagnostics

With `CHAT_DIAGNOSTICS` enabled (default), each MCP operation emits one sanitized JSON line on stderr: stage, tool, duration, outcome, HTTP status, error kind/code, retry attempt, correlation ID and successful tool-call count. Bearer tokens, cookies, JWTs, API keys, authorization values and credential-bearing URLs are redacted, and query bodies/results are never logged.

## Knowledge registry and query templates

`CHAT_DATA_DIR` (mounted volume) holds a persistent, version-controlled-style schema registry: index families, verified field mappings with types, keyword-vs-text classification, date fields and formats, nested paths, bound field roles (release, arch, timestamp, exitcode, …), MCP tool schemas with fingerprints, and per-template validation state — all structural metadata; never query results or credentials. Writes are atomic (`registry.json.tmp` + rename, with `registry.json.bak`), corrupt files are quarantined and the service continues with a warning when the volume is missing or read-only.

Eight parameterized query templates (latest IB, release/arch match, failing RelVals, RelVal failure aggregation, flavour comparison, build comparison, unit-test failures, build status) render only when every field role binds to a real field of a verified live mapping and the rendered arguments validate against the discovered `SearchIndexTool` schema (Ajv). A template is marked validated only after a real query against the matching mapping fingerprint succeeds; mapping fingerprints invalidate cached knowledge on schema change.

## Context-aware investigation

Before the first query the agent receives a compact, deterministic context block: relevant index families for the question, bound roles with types, date/keyword/text conventions from the versioned domain guide `server/chat/knowledge/domain-guide.md`, matched template hints and the current investigation state. Unverified facts are labelled as such and freshness claims are only made from live query results. Per-conversation state tracks attempted queries, successes and gaps. Conversations are isolated: no evidence or history crosses between questions or users.

## Frontend conversation selection

The active conversation is remembered per browser tab (`sessionStorage`): reloading continues the tab's investigation, while a fresh visit starts a new conversation instead of resuming an old thread and re-sending its history on a greeting.

## Benchmark

`node --test tests/chat-benchmark.test.mjs` runs a reproducible scripted workload (6 representative questions, mock MCP server + deterministic model) comparing the baseline configuration (`CHAT_OPTIMIZE=false`, per-question discovery and exploration) with the improved pipeline cold and warm. It measures MCP calls, schema/mapping discovery calls, failed attempts, model calls, prompt size, wall latency, completion and tool-schema cache hit rate. Numbers are synthetic harness measurements — no live CERN services or invented results.

## Security and deployment notes

Read-only by construction: only `ListIndexTool`, `IndexMappingTool` and `SearchIndexTool` are exposed to the model; rendered templates cannot issue writes or scripts. Multi-user sessions never share credentials or caches; registry volumes are per deployment and store no results. The container runs read-only (`--read-only`, `--cap-drop ALL`, `--user $(id -u):$(id -g)`) with three mounts: CA bundle (ro), Kerberos cache (rw, kerberos mode) and the registry data volume (`$HOME/.local/share/cmssdt-chat/data:/var/lib/cmssdt-chat`). Roll back to baseline behaviour at any time with `CHAT_OPTIMIZE=false` without redeploying code.

## Known limitations

- Template coverage is the eight documented investigations; anything else falls back to model-driven exploration with cached schema knowledge.
- The registry TTL is 24 hours for mappings and 7 days before sweep; very rapidly evolving clusters may need shorter TTLs.
- Retry/backoff behaviour is verified against mock servers; live CERN failure modes (proxy quirks, token-exchange edge cases) still need field validation.
- The benchmark uses a scripted model; it measures harness overhead, not answer quality.
