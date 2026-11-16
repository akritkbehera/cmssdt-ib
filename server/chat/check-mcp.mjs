import { loadConfig } from './config.mjs';
import { createAuth } from './auth.mjs';
import { openMcp, discoverTools } from './agent.mjs';
import { publicError } from './errors.mjs';

try {
  const config = loadConfig(), auth = createAuth(config);
  if (auth.mode === 'oidc') throw new Error('Use Sign in with CERN and Test MCP connection in the chat for per-user OIDC mode.');
  const runtime = await auth.resolve({ headers: config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {} });
  const client = await openMcp(runtime, AbortSignal.timeout(45000));
  try {
    const tools = await discoverTools(client, AbortSignal.timeout(30000));
    console.log(JSON.stringify({ endpoint: config.mcpURL, initialized: true, toolsListed: true,
      credentialProvided: Boolean(config.mcpTokenFile || Object.keys(config.mcpHeaders).some(key => key.toLowerCase() === 'authorization')),
      tools: tools.map(tool => tool.function.name), checkedAt: new Date().toISOString() }, null, 2));
  } finally { await client.close(); }
} catch (error) {
  const issue = publicError(error);
  console.error(JSON.stringify({ connected: false, code: issue.code, error: issue.message }));
  process.exitCode = 1;
}
