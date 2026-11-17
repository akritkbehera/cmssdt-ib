import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadConfig } from '../server/chat/config.mjs';
import { createKerberosFetch } from '../server/chat/kerberos.mjs';
import { runAgent } from '../server/chat/agent.mjs';
import { validateToolArguments } from '../server/chat/templates.mjs';
import { validatePpl, executePpl, PPL_TOOL, PPL_TOOL_NAME, createPplLimiter } from '../server/chat/ppl.mjs';

const index = 'cmssdt-externals_stats_summary-2968';
const query = `source = ${index} | stats count() as total`;
const config = loadConfig({ CERN_AI_MODEL: 'existing-model', CERN_AI_KEY: 'model-secret', OPENSEARCH_MCP_HEADERS: '{"Authorization":"Bearer opensearch-secret"}' });
const table = { schema: [{ name: 'total', type: 'bigint' }], datarows: [[1748]], total: 1, size: 1 };
const json = (body = table, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const payload = result => JSON.parse(result.content[0].text);

test('PPL accepts only its complete read-only grammar and appends the output cap after aggregation', () => {
  assert.equal(validatePpl(query).query, `${query} | head 100`);
  assert.equal(validatePpl(`search source=\`${index}\` | where (release = 'CMSSW_20_1_X' and exitcode != 0) or not gpu is null | stats count() as n, avg(total_time) as duration by architecture | sort - n | head 5`, { maxRows: 5 }).maxRows, 5);
  assert.doesNotThrow(() => validatePpl(`source=${index} | where name in ('one', 'two') | fields name, \`@timestamp\` | sort + name`));
  assert.doesNotThrow(() => validatePpl(`source=${index} | where name = 'a | delete source=.security' | stats count()`));
});

test('PPL rejects writes, source bypasses, subqueries, unknown commands, syntax leftovers and oversized input', () => {
  for (const bad of [
    'source=.opendistro_security', 'source=.kibana_1', 'source=.plugins-ml-config',
    'source=remote:cmssdt-ibs-2968', 'source=cmssdt-*', 'source=cmssdt-ibs-2968,.tasks',
    `source=${index} | delete`, `source=${index} | into cmssdt-other`,
    `source=${index} | join [.tasks]`, `source=${index} | append [source=.tasks]`,
    `source=${index} | where name in [source=.tasks]`, `source=${index} | source=.tasks`,
    `source=${index}; source=.tasks`, `source=${index} /* comment */`,
    `source=${index} -- comment`, `source=${index} | eval a=1`,
    `source=${index} | stats values(name)`, `source=${index} | stats count() by span(time,1h)`,
    `source=${index} | where x = script('evil')`, `source=${index} | head 101`,
    `source=${index} | head 0`, `source=${index} | fields *`,
    `source=${index} | where name = 'unterminated`, `source=${index} | where x = 1 #comment`,
    `source=${index} | head 1 |`, `source=${index} | head 1 | stats count()`, `source=${index} | where ${'('.repeat(20)}x = 1${')'.repeat(20)}`,
    `source=${index} | where name = '${'x'.repeat(8000)}'`,
  ]) assert.throws(() => validatePpl(bad), undefined, bad);
  assert.throws(() => validatePpl(query, { maxRows: 0 }));
  assert.throws(() => validatePpl(query, { patterns: ['cmssdt-ibs-*'] }), /not approved/);
});

test('configuration confines credentials to the sibling endpoint and approved CMS index patterns', () => {
  assert.equal(config.pplURL, 'https://os-cmssdt.cern.ch/os/_plugins/_ppl');
  for (const env of [
    { OPENSEARCH_PPL_URL: 'https://other.example/_plugins/_ppl' },
    { OPENSEARCH_PPL_URL: 'https://os-cmssdt.cern.ch/os/_search' },
    { CHAT_PPL_ALLOWED_INDICES: '*' }, { CHAT_PPL_ALLOWED_INDICES: '.security' },
    { CHAT_PPL_ALLOWED_INDICES: 'cmssdt-*x*' }, { CHAT_PPL_TIMEOUT_MS: '30001' },
    { CHAT_PPL_MAX_BYTES: '9999999' },
  ]) assert.throws(() => loadConfig(env));
  assert.equal(loadConfig({ CHAT_PPL_ENABLED: 'false' }).pplEnabled, false);
  assert.equal(validateToolArguments(PPL_TOOL.function.parameters, { query }).ok, true);
  assert.equal(validateToolArguments(PPL_TOOL.function.parameters, { query, url: 'https://evil' }).ok, false);
});

test('direct PPL uses existing OpenSearch bearer authentication, not the model key, and preserves count semantics', async () => {
  const result = await executePpl(config, { query }, { fetchImpl: async (url, init) => {
    assert.equal(url, config.pplURL);
    assert.equal(init.headers.Authorization, 'Bearer opensearch-secret');
    assert.ok(!JSON.stringify(init).includes('model-secret'));
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { query: `${query} | head 100` });
    return json();
  } });
  assert.equal(result.isError, false);
  assert.deepEqual(payload(result).datarows, [[1748]]);
  assert.equal(payload(result).total, 1); // one aggregate row, not one source document
});

test('PPL Kerberos transport uses the same dedicated cache and refuses other endpoints', async () => {
  const kerb = { ...config, mcpHeaders: {}, kerberosCache: 'FILE:/run/cmssdt-krb5/ccache' };
  const request = createKerberosFetch(kerb, async (args, body, signal, cache) => {
    assert.equal(cache, kerb.kerberosCache);
    assert.equal(args.at(-1), config.pplURL);
    assert.ok(args.includes('--negotiate'));
    assert.ok(!args.includes('--location'));
    assert.ok(!args.includes('--insecure'));
    assert.deepEqual(JSON.parse(body), { query });
    return `${JSON.stringify(table)}\n200`;
  }, { target: 'ppl' });
  assert.equal((await request(config.pplURL, { method: 'POST', body: JSON.stringify({ query }) })).status, 200);
  await assert.rejects(request(config.mcpURL, { method: 'POST', body: '{}' }));
  assert.throws(() => createKerberosFetch({ ...kerb, pplURL: 'https://other.example/_plugins/_ppl' }, undefined, { target: 'ppl' }));
});

test('PPL rejected queries never reach the network', async () => {
  let called = false;
  const result = await executePpl(config, { query: 'source=.opendistro_security' }, { fetchImpl: async () => { called = true; } });
  assert.equal(result.isError, true);
  assert.equal(called, false);
});

test('direct PPL makes a real bounded HTTP POST and refuses redirects without forwarding credentials', async t => {
  let redirectsFollowed = 0, redirect = false;
  const server = createServer(async (req, res) => {
    if (req.url === '/elsewhere') { redirectsFollowed++; res.end('unexpected'); return; }
    assert.equal(req.url, '/os/_plugins/_ppl');
    assert.equal(req.headers.authorization, 'Bearer service-token');
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).query, `${query} | head 100`);
    if (redirect) { res.writeHead(302, { Location: '/elsewhere' }).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(table));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const runtime = loadConfig({ OPENSEARCH_MCP_URL: `http://127.0.0.1:${server.address().port}/os/_plugins/_ml/mcp`,
    OPENSEARCH_MCP_HEADERS: '{"Authorization":"Bearer service-token"}' });
  assert.equal((await executePpl(runtime, { query })).isError, false);
  redirect = true;
  assert.equal(payload(await executePpl(runtime, { query })).code, 'ppl_transport_failed');
  assert.equal(redirectsFollowed, 0);
});

test('PPL returns structured sanitized errors for closed/missing indices, syntax, permissions and upstream failures', async () => {
  for (const [status, detail, code] of [
    [400, 'IndexClosedException', 'ppl_index_closed'], [404, 'index_not_found_exception', 'ppl_index_missing'],
    [401, 'private', 'authentication_required'], [403, 'private', 'permission_denied'],
    [400, 'SyntaxCheckException', 'ppl_query_rejected'], [504, 'timed out', 'ppl_timeout'],
    [500, 'private', 'ppl_unavailable'],
  ]) {
    const result = await executePpl(config, { query }, { fetchImpl: async () => json({ error: `${detail} Bearer secret https://internal.example/` }, status) });
    assert.equal(result.isError, true);
    assert.equal(payload(result).code, code);
    assert.ok(!result.content[0].text.includes('secret'));
    assert.ok(!result.content[0].text.includes('internal.example'));
  }
});

test('PPL reuses the existing authenticated refresh callback once on bearer expiry', async () => {
  let calls = 0, refreshes = 0;
  const result = await executePpl({ ...config, authRefresh: async () => { refreshes++; return { mcpHeaders: { Authorization: 'Bearer renewed' } }; } }, { query }, {
    fetchImpl: async (url, init) => {
      if (++calls === 1) return new Response('not JSON', { status: 401 });
      assert.equal(init.headers.Authorization, 'Bearer renewed');
      return json();
    },
  });
  assert.equal(result.isError, false);
  assert.equal(refreshes, 1);
  assert.equal(calls, 2);
});

test('PPL caps rows and bytes, flags limit ambiguity and scrubs credential-shaped result text', async () => {
  const rows = { schema: [{ name: 'value', type: 'string' }], datarows: [['Bearer secret'], ['two'], ['three']], total: 3 };
  const result = await executePpl(config, { query, max_rows: 2 }, { fetchImpl: async () => json(rows) });
  assert.equal(payload(result).returnedRows, 2);
  assert.equal(payload(result).truncated, true);
  assert.equal(payload(result).limitReached, true);
  assert.ok(!result.content[0].text.includes('Bearer secret'));
  const oversized = await executePpl({ ...config, pplMaxBytes: 16 }, { query }, { fetchImpl: async () => json() });
  assert.equal(payload(oversized).code, 'ppl_response_too_large');
  const malformed = await executePpl(config, { query }, { fetchImpl: async () => json({ schema: [], datarows: [[1]] }) });
  assert.equal(payload(malformed).code, 'ppl_invalid_response');
});

test('PPL times out and respects caller cancellation without returning partial evidence', async () => {
  const wait = async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  // Keep the process alive while AbortSignal.timeout uses its unref timer.
  const keepAlive = setInterval(() => {}, 100);
  try {
    const result = await executePpl({ ...config, pplTimeout: 10 }, { query }, { fetchImpl: wait });
    assert.equal(payload(result).code, 'ppl_timeout');
    const controller = new AbortController();
    const pending = executePpl(config, { query }, { fetchImpl: wait, signal: controller.signal });
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await assert.rejects(pending, /cancelled/);
  } finally { clearInterval(keepAlive); }
});

test('PPL admission limits enforce concurrent and per-minute budgets and recover after release/expiry', () => {
  let time = 1000;
  const admit = createPplLimiter({ now: () => time, concurrency: 1, perMinute: 2 });
  const release = admit();
  assert.throws(admit, /budget|busy/);
  release(); release();
  admit()();
  assert.throws(admit, /budget|busy/);
  time += 60000;
  assert.doesNotThrow(() => admit()());
});

test('one existing model loop can call all three MCP tools plus local PPL without a second model or MCP registration', async () => {
  const remote = [], events = []; let turn = 0, local = 0;
  const names = ['ListIndexTool', 'IndexMappingTool', 'SearchIndexTool'];
  const client = { listTools: async () => ({ tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) }),
    callTool: async call => { remote.push(call.name); return { content: [{ type: 'text', text: '{}' }] }; }, close: async () => {} };
  const model = { chat: { completions: { create: async request => (async function* () {
    if (++turn === 1) {
      assert.deepEqual(request.tools.map(tool => tool.function.name), [...names, PPL_TOOL_NAME]);
      yield { choices: [{ delta: { tool_calls: [...names, PPL_TOOL_NAME].map((name, i) => ({ index: i, id: `call${i}`, function: { name, arguments: JSON.stringify(name === PPL_TOOL_NAME ? { query } : {}) } })) }, finish_reason: 'tool_calls' }] };
    } else {
      assert.ok(request.messages.some(message => message.role === 'tool' && message.content.includes('1748')));
      yield { choices: [{ delta: { content: 'The fixture returned 1748 records.' }, finish_reason: 'stop' }] };
    }
  })() } } };
  await runAgent({ config: { ...config, maxSteps: 3, pplPreflight: false }, messages: [{ role: 'user', content: `How many records are in ${index}?` }], client, model,
    emit: event => events.push(event), pplExecute: async (runtime, args, options) => { local++; return executePpl(runtime, args, { ...options, fetchImpl: async () => json() }); } });
  assert.deepEqual(remote, names);
  assert.equal(local, 1);
  assert.equal(turn, 2);
  assert.equal(events.at(-1).type, 'done');
});

test('disabling PPL leaves the three existing MCP tools available', async () => {
  const names = ['ListIndexTool', 'IndexMappingTool', 'SearchIndexTool'];
  const client = { listTools: async () => ({ tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) }), close: async () => {} };
  const model = { chat: { completions: { create: async request => {
    assert.deepEqual(request.tools.map(tool => tool.function.name), names);
    return (async function* () { yield { choices: [{ delta: { content: 'MCP remains available.' }, finish_reason: 'stop' }] }; })();
  } } } };
  await runAgent({ config: { ...config, pplEnabled: false }, messages: [{ role: 'user', content: 'What tools are available?' }], client, model, emit: () => {} });
});

test('opt-in live PPL count through the configured OpenSearch credentials', { skip: process.env.CHAT_PPL_LIVE_TEST !== '1' }, async t => {
  const live = loadConfig();
  const source = process.env.CHAT_PPL_LIVE_INDEX;
  assert.ok(source, 'Set CHAT_PPL_LIVE_INDEX to an authorized concrete open index.');
  // For OIDC bearer mode, use the backend-resolved runtime instead; this CLI
  // test intentionally supports the existing dedicated Kerberos cache or
  // explicitly configured service headers, not browser session extraction.
  const result = await executePpl(live, { query: `source = ${source} | stats count() as total` });
  assert.equal(result.isError, false, result.content[0].text);
  const count = payload(result).datarows[0]?.[0];
  assert.equal(typeof count, 'number');
  assert.ok(count >= 0);
  t.diagnostic(`Live PPL count verified: ${count} records; no assumption that the historical 1748 snapshot is unchanged.`);
});
