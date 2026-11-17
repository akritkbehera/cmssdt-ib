import { DEFAULT_PPL_INDICES } from './ppl.mjs';

export function loadConfig(env = process.env) {
  const host = env.CHAT_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !env.CHAT_ACCESS_TOKEN && !(env.CERN_OIDC_CLIENT_ID && env.CERN_OIDC_CLIENT_SECRET)) {
    throw new Error('CHAT_ACCESS_TOKEN is required when listening beyond localhost.');
  }
  const config = {
    host, port: Number(env.CHAT_PORT || 8787),
    apiKey: env.CERN_AI_KEY || env.CERN_AI_TOKEN, model: env.CERN_AI_MODEL,
    baseURL: env.CERN_AI_BASE_URL || 'https://aigw.cern.ch/v1',
    mcpURL: env.OPENSEARCH_MCP_URL || 'https://os-cmssdt.cern.ch/os/_plugins/_ml/mcp',
    mcpHeaders: JSON.parse(env.OPENSEARCH_MCP_HEADERS || '{}'),
    kerberosCache: env.OPENSEARCH_KRB5CCNAME,
    mcpTokenFile: env.OPENSEARCH_TOKEN_FILE,
    mcpAudience: 'itos_cmssdt',
    oidcClientId: env.CERN_OIDC_CLIENT_ID,
    oidcClientSecret: env.CERN_OIDC_CLIENT_SECRET,
    oidcRedirectURI: env.CERN_OIDC_REDIRECT_URI,
    accessToken: env.CHAT_ACCESS_TOKEN,
    origins: (env.CHAT_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,https://akritkbehera.github.io').split(',').map(s => s.trim()),
    mcpTimeout: Number(env.CHAT_MCP_TIMEOUT_MS || 120000),
    pplEnabled: env.CHAT_PPL_ENABLED !== 'false',
    pplTimeout: Number(env.CHAT_PPL_TIMEOUT_MS || 120000),
    pplMaxBytes: Number(env.CHAT_PPL_MAX_BYTES || 131072),
    pplIndices: env.CHAT_PPL_ALLOWED_INDICES ? env.CHAT_PPL_ALLOWED_INDICES.split(',').map(s => s.trim()) : [...DEFAULT_PPL_INDICES],
  };
  if (!Number.isInteger(config.mcpTimeout) || config.mcpTimeout < 1000 || config.mcpTimeout > 600000) throw new Error('CHAT_MCP_TIMEOUT_MS must be between 1000 and 600000.');
  const mcp = new URL(config.mcpURL);
  const ppl = new URL(mcp.href);
  ppl.pathname = mcp.pathname.endsWith('/_plugins/_ml/mcp') ? mcp.pathname.replace(/\/_plugins\/_ml\/mcp$/, '/_plugins/_ppl') : '/_plugins/_ppl';
  ppl.search = ''; ppl.hash = '';
  config.pplURL = env.OPENSEARCH_PPL_URL || ppl.href;
  if (config.pplURL !== ppl.href) throw new Error('OPENSEARCH_PPL_URL must be the sibling /_plugins/_ppl endpoint on the configured OpenSearch origin.');
  if (!Number.isInteger(config.pplTimeout) || config.pplTimeout < 1000 || config.pplTimeout > 600000) throw new Error('CHAT_PPL_TIMEOUT_MS must be between 1000 and 600000.');
  if (!Number.isInteger(config.pplMaxBytes) || config.pplMaxBytes < 1024 || config.pplMaxBytes > 131072) throw new Error('CHAT_PPL_MAX_BYTES must be between 1024 and 131072.');
  if (!config.pplIndices.length || config.pplIndices.some(p => !/^cmssdt-[a-z0-9_-]+(?:\*)?$/.test(p))) throw new Error('CHAT_PPL_ALLOWED_INDICES accepts concrete cmssdt names or cmssdt family prefixes with one trailing *.');
  if (!config.mcpHeaders || typeof config.mcpHeaders !== 'object' || Array.isArray(config.mcpHeaders)) throw new Error('OPENSEARCH_MCP_HEADERS must be a JSON object.');
  if (Object.keys(config.mcpHeaders).some(key => key.toLowerCase() === 'cookie')) throw new Error('SSO cookies are not supported for API authentication. Use a dedicated credential or OIDC token.');
  if (config.oidcClientId || config.oidcClientSecret || config.oidcRedirectURI) {
    if (!config.oidcClientId || !config.oidcClientSecret || !config.oidcRedirectURI) throw new Error('Configure CERN_OIDC_CLIENT_ID, CERN_OIDC_CLIENT_SECRET and CERN_OIDC_REDIRECT_URI together.');
    if (config.oidcClientId === 'opensearch-cli') throw new Error('Register a separate web/backend OIDC client. opensearch-cli is reserved here for the documented CLI token flow.');
    const callback = new URL(config.oidcRedirectURI);
    if (callback.pathname !== '/api/chat/auth/callback' || callback.search || callback.hash || callback.username || callback.password ||
      (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname)))) throw new Error('Use an HTTPS callback ending in /api/chat/auth/callback (HTTP allowed only on loopback).');
  }
  for (const key of ['baseURL', 'mcpURL']) if (config[key]) {
    const url = new URL(config[key]);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid ${key}`);
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error(`${key} must use HTTPS except for local tests.`);
  }
  if (config.kerberosCache) {
    if (!config.kerberosCache.startsWith('FILE:/run/cmssdt-krb5/')) throw new Error('Use a dedicated FILE cache under /run/cmssdt-krb5/.');
    if (config.mcpTokenFile || Object.keys(config.mcpHeaders).length) throw new Error('Do not combine Kerberos with OpenSearch bearer tokens or custom headers.');
    if (new URL(config.mcpURL).origin !== 'https://os-cmssdt.cern.ch') throw new Error('Kerberos is restricted to the CERN CMSSDT endpoint.');
  }
  return config;
}

export function validateMessages(body) {
  if (!Array.isArray(body?.messages) || !body.messages.length || body.messages.length > 100) {
    throw new Error('Send between 1 and 100 messages. Start a new conversation if this one is too long.');
  }
  let length = 0;
  const messages = body.messages.map(message => {
    if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('Messages must contain user or assistant text.');
    }
    length += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (length > 160000) throw new Error('Conversation is too large. Start a new conversation.');
  if (messages.at(-1).role !== 'user') throw new Error('The last message must be a question.');
  return messages;
}
