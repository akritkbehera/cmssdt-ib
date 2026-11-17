# IB Insights chat

Open `#/insights`, or use **IB Insights** in the dashboard navigation. The chat route works even if the build data service is unavailable.

The interface uses assistant-ui's local runtime and primitives. Conversations, titles and messages live in IndexedDB under this site's origin. They remain on this browser/device until deleted or site data is cleared. No account or server chat database is required. Requests send bounded recent context from the active conversation to the backend; messages are then sent to the CERN model and tool queries to OpenSearch. Switching conversations cancels an active response. A browser storage failure is reported instead of silently falling back to unsaved history.

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

Register the existing `ListIndexTool`, `IndexMappingTool` and `SearchIndexTool` with the native MCP server. The model receives those three discovered tools plus the local `execute_opensearch_ppl` tool. Tool arguments are validated against their schemas. The backend executes only model-requested tools; there are no automatic PPL probes, query plans, schema-registry blocks, domain guides or snapshot prompts.

Only the active conversation, current tool definitions/results and a short safety instruction are sent to the existing CERN model. No additional LLM or generated context is used. Actual read permissions remain enforced by OpenSearch. Health reports configuration only; **Test MCP connection** verifies initialization and discovery, not inference or PPL execution.

The investigation has no overall wall-clock deadline or tool-step limit. The stream sends heartbeats every ten seconds while tools/model calls are pending. User cancellation or client disconnection aborts upstream work; a completed answer ends normally. Individual MCP/PPL calls default to 120 seconds, configurable up to ten minutes with `CHAT_MCP_TIMEOUT_MS` and `CHAT_PPL_TIMEOUT_MS`. The model HTTP request uses the user cancellation signal instead of an SDK deadline. External gateway, proxy and cluster limits or failures can still terminate a request; no application can override those limits.

Tool outputs are capped per result, and oldest complete tool exchanges are discarded when the working transcript grows large. This uses actual retained conversation/tool evidence, not injected summaries, and does not delete browser-local history. Token-limited text answers are continued in the same streamed response. The read-only PPL parser, approved indices, response-size caps, request admission limits and credential redaction remain enforced. See [direct PPL](opensearch-ppl.md).

## Local development

Run `npm start` in a second terminal. Vite proxies `/api/chat` to port 8787. Leave **Connection → Backend address** empty. In service mode, enter `CHAT_ACCESS_TOKEN` in Connection if configured. Manually entered service access tokens are held in memory only and cleared on reload. Conversations continue to persist in IndexedDB.

## GitHub Pages deployment

Pages hosts the UI but cannot hold the model key or run this backend. Deploy `server/chat/index.mjs` on a CERN-reachable Node 24 service behind HTTPS. An optional Dockerfile is provided at `server/chat/Dockerfile` (build from repository root). Allow the exact Pages origin in `CHAT_ALLOWED_ORIGINS`. Beyond loopback, service mode requires `CHAT_ACCESS_TOKEN`; OIDC mode requires a registered confidential client and per-user login. Use a least-privilege OpenSearch identity.

Open Connection and enter the backend HTTPS address without `/api/chat`. The address and an opaque application-session handle are saved in localStorage. CERN sign-in survives tabs/reloads for up to eight hours; logout clears the remembered handle in all tabs. Every request validates it server-side. Backend restart invalidates sessions. Manually entered service access tokens remain memory-only. CERN keys and OpenSearch tokens never go into the UI. Alternatively set the GitHub Actions repository variable `CHAT_BACKEND_URL`; the Pages workflow embeds this public address as `VITE_CHAT_BACKEND_URL`. Never put secrets in any `VITE_` variable or Actions variable.

The server binds to localhost by default. It stores no conversations and logs no request bodies. Browser cancellation aborts model and MCP requests. Follow-up context includes the prior user/assistant text; tool responses are used during each investigation and must be queried again when a follow-up needs fresh evidence.

## Verification

```sh
npm run test:chat
npm run build:pages
```

Tests use local model/MCP endpoints and fake IndexedDB. CI runs Chromium, Firefox and WebKit checks for chat persistence, context, OIDC popup messaging, remembered sessions across reloads/tabs, expiry, logout, cancellation, and mobile layout. These are fixtures, not evidence of live CERN authentication. After deployment, use **Test MCP connection** or `npm run chat:check` in service mode to verify real `tools/list`, then ask a question to test model inference.

## Failure reporting and retries

The backend classifies every failure into a real category instead of a generic message: `authentication` (401/token expiry), `authorization` (403), `timeout`, `cancelled` (browser abort), `session` (expired MCP session), `protocol` (JSON-RPC errors), `invalid_arguments` (tool schema mismatch), `http_transient` (5xx/429), `http_client`, `transport` (reset/refused sockets) and `unknown`. Each category has a distinct public `code` and message; raw upstream payloads and credentials are never echoed to the client.

Only transient failures are retried; internal MCP -32603 errors are not replayed automatically: bounded exponential backoff with jitter, abort-aware, never for auth or invalid-argument errors, and never replaying an investigation (only the single failed operation is retried). Expired MCP sessions reinitialize exactly once — with forced credential renewal in OIDC mode before reconnecting — and broken transports get a fresh SDK client. Tool-call limits per response and per-result/working-transcript caps protect the service without imposing an investigation step limit.

## Diagnostics

With `CHAT_DIAGNOSTICS` enabled (default), each MCP operation emits one sanitized JSON line on stderr: stage, tool, duration, outcome, HTTP status, error kind/code, retry attempt, correlation ID and successful tool-call count. Bearer tokens, cookies, JWTs, API keys, authorization values and credential-bearing URLs are redacted, and query bodies/results are never logged.

## Context and deployment

The former knowledge registry, query planner, domain-guide injection, operational snapshot warm-up and PPL-first inspection are disconnected from the live agent. Historical discovery artifacts and helper tests are retained as source history only; the running chatbot does not read them or mount the registry data directory. Browser-local conversation history and per-tab selection remain unchanged.

The container runs read-only with dropped capabilities, the public CA bundle and the dedicated Kerberos cache. No registry volume is required. Do not delete the existing host data directory merely to disable context; it is simply no longer mounted/read.

For long streams, the reverse proxy must allow streaming and avoid a hard total-duration limit. Apache's proxy socket timeout is an idle timeout; the ten-second heartbeat prevents idle periods while an investigation is active. Backend restarts or network interruptions still close active responses.
