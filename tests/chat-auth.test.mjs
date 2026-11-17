import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as oidc from 'openid-client';
import { createAuth } from '../server/chat/auth.mjs';
import { loadConfig } from '../server/chat/config.mjs';
import { createChatServer } from '../server/chat/index.mjs';

async function start(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('OIDC configuration requires a distinct confidential client and exact HTTPS callback', () => {
  assert.throws(() => loadConfig({ CERN_OIDC_CLIENT_ID: 'new-client' }), /together/);
  assert.throws(() => loadConfig({ CERN_OIDC_CLIENT_ID: 'opensearch-cli', CERN_OIDC_CLIENT_SECRET: 'test', CERN_OIDC_REDIRECT_URI: 'https://backend.test/api/chat/auth/callback' }), /separate/);
  assert.throws(() => loadConfig({ OPENSEARCH_MCP_HEADERS: '{"Cookie":"existing-session"}' }), /cookies/);
  assert.equal(loadConfig({ CERN_AI_TOKEN: 'alias-test' }).apiKey, 'alias-test');
  assert.equal(loadConfig({}).mcpURL, 'https://os-cmssdt.cern.ch/os/_plugins/_ml/mcp');
});

test('PKCE login binds state and cookie, returns only an opaque session, and logout revokes it', async t => {
  let expireTarget = false;
  const origin = 'https://akritkbehera.github.io';
  const config = loadConfig({ CERN_OIDC_CLIENT_ID: 'insights-test', CERN_OIDC_CLIENT_SECRET: 'private-server-secret',
    CERN_OIDC_REDIRECT_URI: 'https://backend.test/api/chat/auth/callback' });
  const provider = new oidc.Configuration({ issuer: 'https://auth.cern.ch/auth/realms/cern', authorization_endpoint: 'https://auth.cern.ch/auth/realms/cern/protocol/openid-connect/auth', token_endpoint: 'https://auth.cern.ch/auth/realms/cern/protocol/openid-connect/token' }, config.oidcClientId, config.oidcClientSecret);
  const auth = createAuth(config, {
    discover: async () => provider,
    codeGrant: async (_provider, url, checks) => {
      assert.equal(url.origin, 'https://backend.test'); assert.equal(url.searchParams.get('code'), 'code-for-test');
      assert.ok(checks.pkceCodeVerifier.length >= 43); assert.ok(checks.expectedState); assert.ok(checks.expectedNonce);
      return { access_token: 'source-access-secret', refresh_token: 'source-refresh-secret' };
    },
    exchange: async () => ({ accessToken: 'target-access-secret', expires: Date.now() + (expireTarget ? -1 : 3600000) }),
    refreshGrant: async () => { throw new Error('invalid_grant: private refresh details'); },
  });
  const url = await start(t, createChatServer(config, undefined, { auth }));
  const login = await fetch(`${url}/api/chat/auth/start?origin=${encodeURIComponent(origin)}&login_id=12345678-1234-1234-1234-123456789abc`, { redirect: 'manual' });
  assert.equal(login.status, 302);
  const authorization = new URL(login.headers.get('location'));
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('client_id'), 'insights-test');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const callback = `${url}/api/chat/auth/callback?state=${authorization.searchParams.get('state')}&code=code-for-test`;
  const response = await fetch(callback, { headers: { Cookie: cookie } });
  const html = await response.text();
  for (const secret of ['source-access-secret', 'source-refresh-secret', 'target-access-secret', config.oidcClientSecret]) assert.ok(!html.includes(secret));
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const message = JSON.parse(html.match(/postMessage\((\{.*?\}),/s)[1]);
  assert.equal(message.loginId, '12345678-1234-1234-1234-123456789abc');
  assert.ok(message.session.length >= 32);
  const restored = await fetch(`${url}/api/chat/auth/session`, { headers: { Authorization: `Bearer ${message.session}` } });
  assert.equal(restored.status, 200);
  const restoredData = await restored.json();
  assert.equal(restoredData.authenticated, true);
  assert.equal(restoredData.expiresAt, message.expiresAt);
  assert.ok(!JSON.stringify(restoredData).includes('secret'));
  assert.equal((await fetch(callback, { headers: { Cookie: cookie } })).status, 400, 'callback cannot replay');
  const runtime = await auth.resolve({ headers: { authorization: `Bearer ${message.session}` } });
  assert.equal(runtime.mcpHeaders.Authorization, 'Bearer target-access-secret');
  await fetch(`${url}/api/chat/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${message.session}` } });
  assert.equal((await fetch(`${url}/api/chat/auth/session`, { headers: { Authorization: `Bearer ${message.session}` } })).status, 401);
  await assert.rejects(() => auth.resolve({ headers: { authorization: `Bearer ${message.session}` } }), error => error.code === 'authentication_required');
  assert.equal((await fetch(`${url}/api/chat/auth/start?origin=https://evil.test&login_id=12345678-1234-1234-1234-123456789abc`, { redirect: 'manual' })).status, 400);
  const another = await fetch(`${url}/api/chat/auth/start?origin=${encodeURIComponent(origin)}&login_id=22345678-1234-1234-1234-123456789abc`, { redirect: 'manual' });
  const anotherState = new URL(another.headers.get('location')).searchParams.get('state');
  assert.equal((await fetch(`${url}/api/chat/auth/callback?state=${anotherState}&code=code-for-test`)).status, 400, 'state alone cannot replace the login binding cookie');
  expireTarget = true;
  const expiring = await fetch(`${url}/api/chat/auth/start?origin=${encodeURIComponent(origin)}&login_id=32345678-1234-1234-1234-123456789abc`, { redirect: 'manual' });
  const expiringState = new URL(expiring.headers.get('location')).searchParams.get('state');
  const expiringResponse = await fetch(`${url}/api/chat/auth/callback?state=${expiringState}&code=code-for-test`, { headers: { Cookie: expiring.headers.get('set-cookie').split(';')[0] } });
  const expiringMessage = JSON.parse((await expiringResponse.text()).match(/postMessage\((\{.*?\}),/s)[1]);
  await assert.rejects(() => auth.resolve({ headers: { authorization: `Bearer ${expiringMessage.session}` } }), error => error.status === 401 && error.code === 'authentication_required' && !error.message.includes('private'));
});

test('fresh CLI token file is re-read so renewal does not require server restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'insights-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'token');
  await writeFile(file, 'first-token', { mode: 0o600 });
  const auth = createAuth(loadConfig({ OPENSEARCH_TOKEN_FILE: file }), { verify: async token => { if (token === 'expired') throw new Error('expired'); } });
  assert.equal((await auth.resolve({ headers: {} })).mcpHeaders.Authorization, 'Bearer first-token');
  await writeFile(file, 'renewed-token');
  assert.equal((await auth.resolve({ headers: {} })).mcpHeaders.Authorization, 'Bearer renewed-token');
  await writeFile(file, 'expired');
  await assert.rejects(() => auth.resolve({ headers: {} }), error => error.status === 401);
});

test('connection status succeeds only after real discovery and maps auth failures', async t => {
  let calls = 0, closed = 0;
  const config = loadConfig({});
  const server = createChatServer(config, undefined, {
    openMcp: async () => ({ close: async () => closed++ }),
    discoverTools: async () => { calls++; return [{ function: { name: 'ListIndexTool' } }]; },
  });
  const url = await start(t, server);
  const health = await (await fetch(`${url}/api/chat/health`)).json();
  assert.equal(health.connectionVerified, false); assert.equal(calls, 0);
  const result = await (await fetch(`${url}/api/chat/connection`, { method: 'POST' })).json();
  assert.equal(result.connected, true); assert.deepEqual(result.tools, ['ListIndexTool']); assert.equal(calls, 1); assert.equal(closed, 1);
  const denied = await start(t, createChatServer(config, undefined, { openMcp: async () => { throw { status: 403, message: 'secret internal error' }; } }));
  const response = await fetch(`${denied}/api/chat/connection`, { method: 'POST' });
  assert.equal(response.status, 403); const issue = await response.json();
  assert.equal(issue.code, 'permission_denied'); assert.ok(!issue.error.includes('secret'));
});
