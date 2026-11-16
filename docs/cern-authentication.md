# CERN OpenSearch authentication and deployment

## Architecture and verified findings

The existing repository is `akritkbehera/cmssdt-ib`, React 19 + Vite, deployed from `master` to GitHub Pages by `.github/workflows/deploy-pages.yml`. IB Insights uses assistant-ui, IndexedDB history, a streamed backend endpoint, the OpenAI-compatible CERN gateway, and an MCP SDK client. This integration preserves that architecture and history database.

The browser calls our small backend. The backend holds the CERN model key and authenticates to the **existing native** OpenSearch server; it does not implement or host a replacement MCP server.

Official sources inspected on 16 November 2026:

- [CERN direct API access](https://opensearch.docs.cern.ch/data_access/direct_api/#oidc-token): `/os` is required; the documented CLI is `auth-get-user-token -c opensearch-cli -a itos_{cluster}`. The audience must use the actual cluster identity. This deployment uses the requested `itos_cmssdt` audience.
- [CERN native MCP](https://opensearch.docs.cern.ch/ai_features/mcp_server/): Streamable HTTP at `/os/_plugins/_ml/mcp`, with a dedicated least-privilege identity recommended.
- [CERN securing APIs](https://auth.docs.cern.ch/user-documentation/oidc/securing-apis/): do not rely on browser SSO cookies for new API integrations.
- [CERN token exchange](https://auth.docs.cern.ch/user-documentation/oidc/exchange-for-api/): exchange to a different application audience requires approval in the Application Portal.
- [CERN OIDC configuration](https://auth.docs.cern.ch/user-documentation/oidc/config/) and [discovery](https://auth.cern.ch/auth/realms/cern/.well-known/openid-configuration): Authorization Code is supported and S256 is advertised for PKCE.

The implementation does not use `opensearch-cli` for browser Authorization Code login. It requires a separate confidential client for the backend. A browser public client could only be considered after registering its own exact redirect URI and web origin, arranging the required audience/token-exchange permissions, and validating CORS at the relevant endpoints. No such registration or CORS permission was established during this investigation. Even successful direct MCP CORS would not make it safe to publish the CERN AI key.

## Access/CORS investigation status

Unauthenticated POST initialization and OPTIONS probes to `https://os-cmssdt.cern.ch/os/_plugins/_ml/mcp` from the execution environment returned HTTP 503 through an intermediary. No successful Access-Control-Allow-Origin response was observed. **This does not prove that the cluster rejects CORS**, nor does it establish origin permission or authenticated access. A probe to the AI gateway also returned 503.

The connected browser could read the official CERN documentation, but direct MCP access and later application inspection were blocked by the browser app's configuration. No existing SSO cookies or tokens were extracted. Browser-session reuse was therefore not verified and is not used as API authentication. No live authenticated `tools/list` has succeeded from the new backend during implementation.

The backend architecture avoids needing OpenSearch to permit the Pages origin. Only our backend must allow `https://akritkbehera.github.io`; it makes server-to-server MCP and model requests.

## Option A: connect now with a newly issued CLI token

On a CERN-reachable machine with Node 24 and CERN's `auth-get-user-token` installed:

```sh
git switch master
git pull --ff-only
npm ci
cp .env.chat.example .env.chat
mkdir -p .secrets
chmod 700 .secrets
umask 077
auth-get-user-token -c opensearch-cli -a itos_cmssdt -o .secrets/opensearch.token -x
```

This obtains a **new credential specifically for this integration**, using CERN's documented CLI flow. Complete its CERN login yourself. Use an identity with the minimum read/MCP-execution permissions; do not expose a personal administrator credential in a shared service. `.secrets/` and `.env.chat` are gitignored.

In `.env.chat`, set:

```dotenv
CERN_AI_MODEL=YOUR_AVAILABLE_TOOL_CALLING_MODEL
OPENSEARCH_MCP_URL=https://os-cmssdt.cern.ch/os/_plugins/_ml/mcp
OPENSEARCH_TOKEN_FILE=/ABSOLUTE/PATH/TO/REPO/.secrets/opensearch.token
```

Supply `CERN_AI_KEY` or `CERN_AI_TOKEN` through the backend environment. Leave the three `CERN_OIDC_*` settings empty for this mode. No CERN AI key belongs in the browser or GitHub Pages configuration.

```sh
npm run chat:check
npm run chat:server
```

`chat:check` must report `initialized: true`, `toolsListed: true` and `credentialProvided: true` before calling the authenticated MCP connection working. A list containing only `ListIndexTool` does not enable search or mappings. The token file is re-read and its signature, issuer, expiry and `itos_cmssdt` audience are verified for each request. Obtain a fresh token with the same CLI command when it expires; no backend restart is needed. For managed renewal, CERN documents `oidc-agent` separately; no unsupported Kerberos-to-SSO renewal is added here.

For local UI testing, run `npm start` in another terminal and open `http://localhost:5173/#/insights`. Leave the Connection address empty. Use **Test MCP connection**, then ask a bounded question. If working over SSH, forward ports 5173 and 8787 from this machine.

## Option B: per-user CERN login in the deployed browser app

This path is implemented but requires external registration and approval:

1. Arrange a CERN-reachable backend HTTPS address, for example `https://YOUR_BACKEND`. Proxy the `/api/chat` path to this Node service on port 8787 without buffering streamed responses. Keep TLS verification enabled.
2. In the [CERN Application Portal](https://application-portal.web.cern.ch), register an OIDC application for IB Insights. Use a **confidential client**, because its secret is stored only on the backend. Enable Authorization Code/standard flow and S256 PKCE. Register the **exact** callback `https://YOUR_BACKEND/api/chat/auth/callback`; do not register a Pages hash route or a wildcard callback.
3. In that client's **Token Exchange** section, request permission for target audience/application **`itos_cmssdt`**. Have the target owner approve it. A successful login to your client alone does not establish OpenSearch access.
4. Have the OpenSearch owner map the intended users/groups to a role with the necessary read privileges for CMSSDT indices and permission to execute the registered read tools. Keep tool registration/admin/write privileges separate from the agent identity.
5. Configure these backend-only settings:

```dotenv
CERN_OIDC_CLIENT_ID=YOUR_NEW_CLIENT_ID
CERN_OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET
CERN_OIDC_REDIRECT_URI=https://YOUR_BACKEND/api/chat/auth/callback
CHAT_ALLOWED_ORIGINS=https://akritkbehera.github.io
```

Keep the model key and model name configured as in Option A. Leave `OPENSEARCH_TOKEN_FILE` empty: each logged-in user's target token is obtained independently. No OpenSearch CORS change is needed for this architecture. If a local proxy/CERN route requires additional authentication, its administrator must permit this backend's requests using a supported service configuration.

6. Deploy/start the backend. In GitHub repository **Settings → Secrets and variables → Actions → Variables**, set public variable **`CHAT_BACKEND_URL`** to `https://YOUR_BACKEND`, then rerun the Pages deployment. Alternatively enter that public address in the app's Connection settings.
7. Click **Sign in with CERN**. The backend uses Authorization Code + PKCE, verifies the state/nonce and its own short-lived HttpOnly login cookie, exchanges the resulting user token for `itos_cmssdt`, then verifies the target token's signature/issuer/audience/expiry. Only an opaque app-session handle is sent to the allowed frontend through a source-, origin- and attempt-checked popup message. CERN tokens remain in server memory. The frontend keeps its handle in memory only. Reloading requires sign-in again; IndexedDB conversations remain.
8. The app then tests real initialization and `tools/list`. Only that success sets the verified status. Send a question to confirm model inference and actual tool execution too.

Sessions expire after eight hours or when their credential cannot be refreshed. Logout removes this app's session without forcing logout from unrelated CERN services. Restarting the backend clears sessions, requiring sign-in again. A single backend process is assumed; multiple replicas would require a shared protected session store or sticky routing and a corresponding security review.

## Dedicated service alternative

CERN's MCP documentation recommends a dedicated internal user with minimal rights. An administrator can provision that user and supply a supported Basic Authorization header in `OPENSEARCH_MCP_HEADERS`, held only on the backend. In service mode, bind to loopback behind a trusted proxy, or set a strong `CHAT_ACCESS_TOKEN` before binding externally. Enter that **app access token** in Connection; it is unrelated to the CERN model key and OpenSearch credential, and is not saved to browser storage.

## Tool availability and error handling

`initialize`, paginated `tools/list`, and `tools/call` use the MCP SDK's Streamable HTTP implementation. Only `ListIndexTool`, `IndexMappingTool`, and `SearchIndexTool` are exposed, and their discovered schemas validate model arguments. Cluster roles remain the enforcement boundary for index access. Tool output is treated as untrusted data; execution/time/context limits apply.

- OpenSearch 401: renew the token or sign in again.
- OpenSearch 403: request read/MCP-execution permission; repeated login does not grant missing rights.
- Model 401/403: fix the backend's CERN AI credential or model permission, not the OpenSearch login.
- No approved tools: ask a cluster administrator to register the mapping/search tools if needed. The frontend never registers tools or changes cluster privileges.
- Backend fetch failure: check backend availability, TLS, the exact allowed Pages origin, and browser network policy. A JavaScript network error alone cannot distinguish CORS from DNS/TLS/network failure.
- Timeout or unavailable endpoint: show an explicit error and do not mark the connection verified.

Local tests and fixture browser tests verify implementation behaviour only. Preserve the real `chat:check` output (without credentials) or a successful app connection result as the deployment evidence.
