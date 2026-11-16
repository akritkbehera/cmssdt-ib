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

`OPENSEARCH_MCP_URL` must point directly to the authenticated `/_plugins/_ml/mcp` endpoint. A successful request inside Dashboards Dev Tools does not establish access from this backend. Configure `OPENSEARCH_MCP_HEADERS` as a JSON object of headers supported by your service, for example `{"Authorization":"Bearer ..."}` if your OpenSearch endpoint accepts that method. CERN model authentication does not authenticate OpenSearch. SSO redirects intentionally fail instead of returning a login page as tool data. Use a trusted CA (`NODE_EXTRA_CA_CERTS` if needed), never disable TLS validation.

Register the existing `ListIndexTool`, `IndexMappingTool` and `SearchIndexTool` with the native MCP server. Only those three names are exposed to the model, with arguments validated against the discovered schemas. The backend creates a Streamable HTTP MCP client per question, discovers/paginates tools, streams the model's response, executes requested tools and continues the model loop. Tool-step, concurrency, context, result-size and request-duration limits keep requests bounded. Actual read permissions and query quotas must be enforced by the OpenSearch identity and cluster policy.

The system prompt asks for exact build identities, mappings before queries, limited searches, comparable architectures, evidence and explicit uncertainty. This does not replace checking model conclusions. Model/provider errors are returned as a safe user-facing error without upstream payloads or credentials. The health endpoint reports configuration presence; the first question tests actual model/MCP connectivity.

## Local development

Run `npm start` in a second terminal. Vite proxies `/api/chat` to port 8787. Leave **Connection → Backend address** empty. If configured, enter `CHAT_ACCESS_TOKEN` in Connection. It is stored only in sessionStorage, separate from chat records.

## GitHub Pages deployment

Pages hosts the chat UI, but cannot run the backend. Deploy `server/chat/index.mjs` on a CERN-reachable Node service, preferably behind your authenticated HTTPS reverse proxy. Set the exact Pages origin in `CHAT_ALLOWED_ORIGINS`; include any other frontend origins explicitly. If binding beyond loopback, the server requires `CHAT_ACCESS_TOKEN`. For a shared service, use per-user authentication at the reverse proxy in addition to this backend token and a read-only OpenSearch identity.

Open Connection on the deployed page and enter the backend HTTPS address (without `/api/chat`) and backend access token. The address is saved in localStorage and the access token for the tab session. No CERN keys or OpenSearch headers are entered in the UI or bundled by Vite. Alternatively set `VITE_CHAT_BACKEND_URL` to a public backend address at build time. Do not put secrets in any `VITE_` variable.

The server binds to localhost by default. It stores no conversations and logs no request bodies. Browser cancellation aborts model and MCP requests. Follow-up context includes the prior user/assistant text; tool responses are used during each investigation and must be queried again when a follow-up needs fresh evidence.

## Verification

```sh
npm run test:chat
npm run build:pages
```

The chat tests use local fake model/MCP endpoints and fake IndexedDB; no CERN credentials are required. CI additionally runs the production page in Chromium, Firefox and WebKit, testing streamed answers, follow-up context, independent chats, rename/delete, reload persistence, connection settings, cancellation and mobile overflow. Real CERN authentication and model tool-calling support must be checked with configured credentials after backend deployment.
