// Explicit operator-only verification; never invoked at startup/deployment.
import { loadConfig } from './config.mjs';
import { createAuth } from './auth.mjs';
import { executePpl } from './ppl.mjs';

try {
  const config = loadConfig();
  const index = process.argv[2];
  if (!index || !/^[a-z][a-z0-9_-]{0,180}$/.test(index)) throw new Error('Pass one authorized concrete open index name.');
  let runtime = config;
  // OIDC+Kerberos deployments authenticate the interactive chat user through
  // SSO but execute reads as the dedicated service Kerberos principal. This
  // operator CLI can use that same cache without extracting a browser session.
  if (!config.kerberosCache) {
    const auth = createAuth(config);
    if (auth.mode === 'oidc') throw new Error('For per-user OIDC bearer mode, verify PPL through a signed-in chat session.');
    runtime = await auth.resolve({ headers: config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {} });
  }
  const result = await executePpl(runtime, { query: `source = ${index} | stats count() as total` }, { signal: AbortSignal.timeout(35000) });
  const payload = JSON.parse(result.content[0].text);
  if (result.isError) { console.error(JSON.stringify({ verified: false, ...payload })); process.exitCode = 1; }
  else {
    const count = payload.datarows[0]?.[0];
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw new Error('PPL did not return a numeric count.');
    console.log(JSON.stringify({ verified: true, count, retrievedAt: payload.retrievedAt }));
  }
} catch (error) {
  // Locally generated messages only; no raw upstream errors escape executePpl.
  console.error(JSON.stringify({ verified: false, error: error.message?.startsWith('Pass ') || error.message?.startsWith('For per-user') ? error.message : 'PPL verification failed. Check configuration, credentials and approved index.' }));
  process.exitCode = 1;
}
