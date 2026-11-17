import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig, validateMessages } from './config.mjs';
import { runAgent, openMcp, discoverTools } from './agent.mjs';
import { createAuth } from './auth.mjs';
import { publicError } from './errors.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { createRegistry } from './registry.mjs';
import { createToolCache } from './mcp.mjs';

export function createChatServer(config, agent = runAgent, options = {}) {
  let active = 0;
  const auth = options.auth || createAuth(config);
  const connect = options.openMcp || openMcp;
  const list = options.discoverTools || discoverTools;
  // Shared structural knowledge (tool schemas, verified mappings, validated
  // templates). It never holds user data, credentials or result payloads and
  // cannot bypass per-user OpenSearch authorization.
  const registry = options.registry || createRegistry({ dir: config.dataDir || '' });
  const registryReady = registry.load?.().catch(() => {});
  const toolCache = options.toolCache || createToolCache();
  async function handle(req, res) {
    const origin = req.headers.origin;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (origin && !config.origins.includes(origin)) { res.writeHead(403).end(); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.writeHead(204).end(); return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (await auth.handle(req, res, url)) return;
    const ready = Boolean(config.apiKey && config.model && config.mcpURL);
    if (req.url === '/api/chat/health' && req.method === 'GET') {
      if (auth.mode === 'service' && config.accessToken) await auth.resolve(req);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ready, model: config.model || null,
        authMode: auth.mode, mcpURL: config.mcpURL, audience: config.mcpAudience,
        connectionVerified: false })); return;
    }
    if (req.url === '/api/chat/connection' && req.method === 'POST') {
      if (active >= 4) { res.writeHead(429).end(); return; }
      const runtime = await auth.resolve(req);
      if (active >= 4) { res.writeHead(429).end(); return; }
      active++;
      const signal = AbortSignal.timeout(45000);
      const diagnostics = createDiagnostics({});
      let client;
      try {
        client = await connect(runtime, signal, { diagnostics });
        const tools = await list(client, signal, { diagnostics });
        diagnostics.log('mcp_operation', { stage: 'tools/list', outcome: 'verified', tool: tools.map(tool => tool.function.name).join(',') });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ connected: true,
          verifiedAt: new Date().toISOString(), tools: tools.map(tool => tool.function.name), modelConfigured: ready,
          endpoint: config.mcpURL }));
      } finally { active--; await client?.close().catch(() => {}); }
      return;
    }
    if (req.url !== '/api/chat' || req.method !== 'POST') { res.writeHead(404).end(); return; }
    const fail = (status, error) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error }));
    const runtime = await auth.resolve(req);
    if (!ready) { fail(503, 'Backend needs CERN_AI_KEY, CERN_AI_MODEL and OPENSEARCH_MCP_URL.'); return; }
    if (active >= 4) { fail(429, 'Chat backend is busy. Try again shortly.'); return; }
    let body = '', messages;
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 512000) throw new Error('Request too large.');
      }
      messages = validateMessages(JSON.parse(body));
    } catch { fail(400, 'Invalid or oversized conversation. Start a new chat if needed.'); return; }
    if (active >= 4) { fail(429, 'Chat backend is busy. Try again shortly.'); return; }
    const controller = new AbortController();
    // Distinct abort reasons distinguish server timeout from client disconnect.
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 180000);
    res.on('close', () => controller.abort(new DOMException('Client disconnected', 'AbortError')));
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'X-Accel-Buffering': 'no' });
    res.flushHeaders(); active++;
    const diagnostics = createDiagnostics({});
    const emit = event => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
    const heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 10000);
    diagnostics.log('chat_request', { stage: 'connect', messages: messages.length });
    try {
      await registryReady;
      await agent({ config: runtime, messages, signal: controller.signal, emit, diagnostics, registry, toolCache });
    } catch (error) {
      const issue = publicError(error);
      diagnostics.log('chat_request', { stage: 'close', outcome: 'error', errorKind: issue.kind, errorCode: issue.code, status: issue.status });
      const text = controller.signal.reason?.name === 'TimeoutError' ? 'Request timed out. Try a narrower question.'
        : issue.code === 'request_cancelled' ? 'Request cancelled before the answer completed.' : issue.message;
      if (!res.destroyed) emit({ type: 'error', code: issue.code, source: issue.source, text });
    } finally { active--; clearTimeout(timer); clearInterval(heartbeat); res.end(); }
  }
  return createServer((req, res) => {
    handle(req, res).catch(error => {
      const issue = publicError(error);
      if (!res.headersSent) res.writeHead(issue.status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: issue.message, code: issue.code, source: issue.source }));
      else res.end();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  createChatServer(config).listen(config.port, config.host, () => console.log(`IB Insights backend listening on ${config.host}:${config.port}`));
}
