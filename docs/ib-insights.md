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

Register the existing `ListIndexTool`, `IndexMappingTool` and `SearchIndexTool` with the native MCP server. Only those three names are exposed to the model, with arguments validated against the discovered schemas. The backend creates a Streamable HTTP MCP client per question, discovers/paginates tools, streams the model's response, executes requested tools and continues the model loop. Tool-step, concurrency, context, result-size and request-duration limits keep requests bounded. Actual read permissions and query quotas must be enforced by the OpenSearch identity and cluster policy.

The system prompt asks for exact build identities, mappings before queries, limited searches, comparable architectures, evidence and explicit uncertainty. This does not replace checking model conclusions. Model/provider errors are returned without upstream payloads or credentials. Health reports configuration only. **Test MCP connection** performs real initialization and tool discovery; only success produces the verified status. This verifies MCP access, not model inference; send a question to verify both.

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
