import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createKerberosFetch } from '../server/chat/kerberos.mjs';
import { createAuth } from '../server/chat/auth.mjs';
import { loadConfig } from '../server/chat/config.mjs';

const config = { mcpURL: 'https://os-cmssdt.cern.ch/os/_plugins/_ml/mcp', kerberosCache: 'FILE:/run/cmssdt-krb5/ccache' };
test('SDK initializes and discovers tools through bounded Kerberos curl requests', async () => {
  const methods = [];
  const fetch = createKerberosFetch(config, async (args, body, signal, cache) => {
    assert.equal(cache, config.kerberosCache);
    assert.equal(args[0], '--disable');
    assert.ok(args.includes('--negotiate'));
    assert.ok(args.includes('@-'));
    assert.ok(!args.includes('--location'));
    assert.ok(!args.some(x => /Bearer|password|insecure/.test(x)));
    const request = JSON.parse(body); methods.push(request.method);
    if (request.id === undefined) return '\n204';
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : { tools: [{ name: 'ListIndexTool', inputSchema: { type: 'object' } }] };
    return JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n200';
  });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpURL), { fetch }));
  assert.equal((await client.listTools()).tools[0].name, 'ListIndexTool');
  await client.close();
  assert.ok(methods.includes('initialize'));
  assert.ok(methods.includes('tools/list'));
});
test('expired tickets and permissions produce actionable sanitized errors', async () => {
  for (const [status, code] of [[401, 'authentication_required'], [403, 'permission_denied']]) {
    const fetch = createKerberosFetch(config, async () => 'private upstream body\n' + status);
    await assert.rejects(fetch(config.mcpURL, { method: 'POST', body: '{}' }), error => error.code === code && !error.message.includes('private upstream'));
  }
});
test('Kerberos transport rejects other destinations and mixed credentials before execution', async () => {
  let calls = 0;
  const fetch = createKerberosFetch(config, async () => { calls++; });
  await assert.rejects(fetch('https://example.com/', { method: 'POST', body: '{}' }));
  await assert.rejects(fetch(config.mcpURL, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer secret' } }));
  assert.equal(calls, 0);
});
test('Kerberos configuration rejects mixed tokens and cache paths outside dedicated mount', () => {
  assert.throws(() => loadConfig({ OPENSEARCH_KRB5CCNAME: 'FILE:/tmp/personal-cache' }));
  assert.throws(() => loadConfig({ OPENSEARCH_KRB5CCNAME: config.kerberosCache, OPENSEARCH_TOKEN_FILE: '/tmp/token' }));
  assert.equal(loadConfig({ OPENSEARCH_KRB5CCNAME: config.kerberosCache }).kerberosCache, config.kerberosCache);
});
test('shared Kerberos credentials do not bypass frontend authentication', async () => {
  const auth = createAuth({ ...config, accessToken: 'required', origins: [] });
  await assert.rejects(auth.resolve({ headers: {} }), error => error.code === 'backend_authentication_required');
  assert.equal((await auth.resolve({ headers: { authorization: 'Bearer required' } })).kerberosCache, config.kerberosCache);
});
