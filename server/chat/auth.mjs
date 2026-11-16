import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as oidc from 'openid-client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ChatError, publicError } from './errors.mjs';

const random = () => randomBytes(32).toString('base64url');
const ISSUER = 'https://auth.cern.ch/auth/realms/cern';
const authRequired = () => new ChatError('authentication_required', 'Sign in to CERN to connect to OpenSearch.', 401, 'opensearch');
const bearer = req => /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
const equals = (a, b) => Boolean(a && b && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)));
function cookieValue(req, name) {
  return (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
function callbackPage(res, origin, payload) {
  const nonce = random();
  const json = JSON.stringify(payload).replaceAll('<', '\\u003c');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
  });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>CERN sign-in</title><body><p>Returning to IB Insights. You may close this window.</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${json},${JSON.stringify(origin)});window.close();}</script></body></html>`);
}

export function createAuth(config, dependencies = {}) {
  const pending = new Map(), sessions = new Map();
  let discovery;
  const keys = createRemoteJWKSet(new URL(`${ISSUER}/protocol/openid-connect/certs`), { timeoutDuration: 10000 });
  const verify = dependencies.verify || (token => jwtVerify(token, keys, { issuer: ISSUER, audience: config.mcpAudience, algorithms: ['RS256'], requiredClaims: ['exp', 'sub'] }));
  const discover = dependencies.discover || (() => oidc.discovery(new URL(ISSUER), config.oidcClientId, config.oidcClientSecret));
  const getProvider = () => discovery ||= discover().catch(error => { discovery = undefined; throw error; });
  const mode = config.oidcClientId ? 'oidc' : 'service';
  const sweep = () => {
    for (const [id, item] of pending) if (item.expires < Date.now()) pending.delete(id);
    for (const [id, item] of sessions) if (item.expires < Date.now()) sessions.delete(id);
  };
  async function exchange(provider, tokens) {
    const endpoint = provider.serverMetadata().token_endpoint;
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.oidcClientId, client_secret: config.oidcClientSecret,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: tokens.access_token,
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token', audience: config.mcpAudience }),
    });
    if (!response.ok) throw new ChatError('audience_not_authorized', `CERN SSO did not authorize token exchange for ${config.mcpAudience}. Request permission for your registered client in the Application Portal.`, 403, 'opensearch');
    const target = await response.json();
    await verify(target.access_token);
    return { accessToken: target.access_token, expires: Date.now() + Math.min(Number(target.expires_in) || 60, 3600) * 1000 };
  }
  const exchangeTokens = dependencies.exchange || exchange;
  const codeGrant = dependencies.codeGrant || oidc.authorizationCodeGrant;
  const refreshGrant = dependencies.refreshGrant || oidc.refreshTokenGrant;
  async function resolve(req) {
    sweep();
    if (mode === 'oidc') {
      const id = bearer(req), session = sessions.get(id);
      if (!session) throw authRequired();
      if (session.target.expires < Date.now() + 30000) {
        session.refresh ||= (async () => {
          const provider = await getProvider();
          if (!session.tokens.refresh_token) throw authRequired();
          const refreshed = await refreshGrant(provider, session.tokens.refresh_token);
          session.tokens = { ...refreshed, refresh_token: refreshed.refresh_token || session.tokens.refresh_token };
          session.target = await exchangeTokens(provider, session.tokens);
        })().catch(error => { sessions.delete(id); throw error instanceof ChatError ? error : authRequired(); }).finally(() => { session.refresh = undefined; });
        await session.refresh;
      }
      return { ...config, mcpHeaders: { ...config.mcpHeaders, Authorization: `Bearer ${session.target.accessToken}` } };
    }
    if (config.accessToken && !equals(bearer(req), config.accessToken)) throw new ChatError('backend_authentication_required', 'Chat backend access token required.', 401, 'backend');
    if (config.mcpTokenFile) {
      let token;
      try { token = (await readFile(config.mcpTokenFile, 'utf8')).trim(); await verify(token); }
      catch { throw new ChatError('authentication_required', 'The OpenSearch token file is missing, expired or has the wrong issuer/audience. Obtain a fresh token for itos_cmssdt using CERN’s supported CLI.', 401, 'opensearch'); }
      return { ...config, mcpHeaders: { ...config.mcpHeaders, Authorization: `Bearer ${token}` } };
    }
    return config;
  }
  return {
    mode, resolve,
    async handle(req, res, url) {
      if (!url.pathname.startsWith('/api/chat/auth/')) return false;
      sweep();
      if (mode !== 'oidc') { res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'CERN login needs a registered OIDC client on the backend.' })); return true; }
      if (url.pathname === '/api/chat/auth/start' && req.method === 'GET') {
        const origin = url.searchParams.get('origin'), loginId = url.searchParams.get('login_id');
        if (!config.origins.includes(origin) || !/^[a-zA-Z0-9-]{20,100}$/.test(loginId || '')) { res.writeHead(400).end(); return true; }
        if (pending.size >= 32) { res.writeHead(429).end(); return true; }
        const state = random(), verifier = oidc.randomPKCECodeVerifier(), nonce = random(), binding = random();
        const provider = await getProvider();
        pending.set(state, { origin, loginId, verifier, nonce, binding, expires: Date.now() + 300000 });
        const redirect = oidc.buildAuthorizationUrl(provider, { redirect_uri: config.oidcRedirectURI, response_type: 'code', scope: 'openid profile',
          state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' });
        const secure = config.oidcRedirectURI.startsWith('https:') ? '; Secure' : '';
        res.writeHead(302, { Location: redirect.href,
          'Set-Cookie': `cmssdt_login_${state}=${binding}; HttpOnly; SameSite=Lax; Max-Age=300; Path=/api/chat/auth${secure}` }).end();
        return true;
      }
      if (url.pathname === '/api/chat/auth/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state'), flow = pending.get(state);
        pending.delete(state);
        if (!flow || !equals(cookieValue(req, `cmssdt_login_${state}`), flow.binding)) { res.writeHead(400).end('Login expired or could not be verified. Start again from IB Insights.'); return true; }
        res.setHeader('Set-Cookie', `cmssdt_login_${state}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/api/chat/auth${config.oidcRedirectURI.startsWith('https:') ? '; Secure' : ''}`);
        try {
          const provider = await getProvider();
          const callback = new URL(config.oidcRedirectURI); callback.search = url.search;
          const tokens = await codeGrant(provider, callback, { pkceCodeVerifier: flow.verifier, expectedState: state, expectedNonce: flow.nonce });
          const target = await exchangeTokens(provider, tokens);
          if (sessions.size >= 128) throw new ChatError('busy', 'Too many active sessions. Try again later.', 429);
          const session = random();
          sessions.set(session, { tokens, target, expires: Date.now() + 8 * 3600000 });
          callbackPage(res, flow.origin, { type: 'cmssdt-cern-login', loginId: flow.loginId, session });
        } catch (error) {
          const issue = publicError(error);
          callbackPage(res, flow.origin, { type: 'cmssdt-cern-login', loginId: flow.loginId, error: issue.message, code: issue.code });
        }
        return true;
      }
      if (url.pathname === '/api/chat/auth/logout' && req.method === 'POST') { sessions.delete(bearer(req)); res.writeHead(204).end(); return true; }
      res.writeHead(404).end(); return true;
    },
  };
}
