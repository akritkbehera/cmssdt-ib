import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig, validateMessages } from './config.mjs';
import { runAgent } from './agent.mjs';

export function createChatServer(config, agent = runAgent) {
  let active = 0;
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (origin && !config.origins.includes(origin)) { res.writeHead(403).end(); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.writeHead(204).end(); return;
    }
    if (config.accessToken) {
      const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${config.accessToken}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Chat backend access token required.' })); return;
      }
    }
    const ready = Boolean(config.apiKey && config.model && config.mcpURL);
    if (req.url === '/api/chat/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ready, model: config.model || null })); return;
    }
    if (req.url !== '/api/chat' || req.method !== 'POST') { res.writeHead(404).end(); return; }
    const fail = (status, error) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error }));
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    res.on('close', () => controller.abort());
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'X-Accel-Buffering': 'no' });
    res.flushHeaders(); active++;
    const emit = event => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
    try { await agent({ config, messages, signal: controller.signal, emit }); }
    catch {
      if (!res.destroyed) emit({ type: 'error', text: controller.signal.aborted
        ? 'Request timed out. Try a narrower question.'
        : 'Investigation failed. Check the configured model, tool-calling support, MCP registration and CERN authentication.' });
    } finally { active--; clearTimeout(timer); res.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  createChatServer(config).listen(config.port, config.host, () => console.log(`IB Insights backend listening on ${config.host}:${config.port}`));
}
