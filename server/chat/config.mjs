export function loadConfig(env = process.env) {
  const host = env.CHAT_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !env.CHAT_ACCESS_TOKEN) {
    throw new Error('CHAT_ACCESS_TOKEN is required when listening beyond localhost.');
  }
  const config = {
    host, port: Number(env.CHAT_PORT || 8787),
    apiKey: env.CERN_AI_KEY, model: env.CERN_AI_MODEL,
    baseURL: env.CERN_AI_BASE_URL || 'https://aigw.cern.ch/v1',
    mcpURL: env.OPENSEARCH_MCP_URL,
    mcpHeaders: JSON.parse(env.OPENSEARCH_MCP_HEADERS || '{}'),
    accessToken: env.CHAT_ACCESS_TOKEN,
    origins: (env.CHAT_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()),
    maxSteps: 8,
  };
  for (const key of ['baseURL', 'mcpURL']) if (config[key]) {
    const url = new URL(config[key]);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid ${key}`);
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
