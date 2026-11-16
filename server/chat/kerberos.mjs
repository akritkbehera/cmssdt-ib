import { spawn } from 'node:child_process';
import { ChatError } from './errors.mjs';

// curl/GSSAPI reads the dedicated credential cache. JS never reads ticket bytes.
export function runKerberosCurl(args, body, signal, cache) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, {
      env: { ...process.env, KRB5CCNAME: cache },
      stdio: ['pipe', 'pipe', 'ignore'], signal,
    });
    const chunks = [];
    let bytes = 0, oversized = false;
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { oversized = true; child.kill(); }
      else chunks.push(chunk);
    });
    child.stdin.on('error', () => {});
    child.on('error', () => reject(new ChatError('kerberos_unavailable', 'Kerberos request could not start or was cancelled. Check curl/GSSAPI and the ticket cache.', 502, 'opensearch')));
    child.on('close', code => {
      if (oversized) return reject(new ChatError('response_too_large', 'OpenSearch response exceeded 2 MiB. Request less data.', 502, 'opensearch'));
      if (code !== 0) return reject(new ChatError('kerberos_request_failed', 'Kerberos connection failed. Check the backend ticket cache, network and ticket expiry.', 502, 'opensearch'));
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(body);
  });
}

export function createKerberosFetch(config, execute = runKerberosCurl) {
  const endpoint = new URL(config.mcpURL).href;
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).href !== endpoint) throw new ChatError('invalid_endpoint', 'Kerberos requests must target the configured MCP endpoint.', 400, 'opensearch');
    const method = (init.method || 'GET').toUpperCase();
    // Native CERN MCP is stateless: no unsolicited SSE stream or session deletion.
    if (method === 'GET') return new Response(null, { status: 405 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (method !== 'POST' || typeof init.body !== 'string') throw new Error('Unsupported Kerberos MCP request.');
    const headers = new Headers(init.headers);
    if (headers.has('authorization') || headers.has('cookie')) throw new Error('Do not mix Kerberos with bearer credentials or cookies.');
    const args = ['--disable', '--silent', '--show-error', '--negotiate', '--user', ':',
      '--proto', '=https', '--connect-timeout', '10', '--max-time', '30',
      '--request', 'POST', '--header', 'Content-Type: application/json',
      '--header', 'Accept: application/json, text/event-stream'];
    for (const name of ['mcp-protocol-version', 'mcp-session-id']) {
      const value = headers.get(name);
      if (value) {
        if (/[\r\n]/.test(value)) throw new Error('Invalid MCP header.');
        args.push('--header', name + ': ' + value);
      }
    }
    args.push('--data-binary', '@-', '--write-out', '\n%{http_code}', endpoint);
    const output = await execute(args, init.body, init.signal, config.kerberosCache);
    const split = output.lastIndexOf('\n');
    const status = Number(output.slice(split + 1)), body = output.slice(0, split);
    if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('Invalid Kerberos HTTP response.');
    if (status === 401) throw new ChatError('authentication_required', 'The backend Kerberos ticket is missing, expired or rejected. Refresh its dedicated cache with kinit, then retry.', 401, 'opensearch');
    if (status === 403) throw new ChatError('permission_denied', 'The Kerberos identity lacks permission for this OpenSearch request.', 403, 'opensearch');
    if (status >= 300 && status < 400) throw new Error('OpenSearch redirected the Kerberos request; redirects are disabled.');
    return new Response([204, 205, 304].includes(status) ? null : body, {
      status, headers: { 'Content-Type': /^\s*(event:|data:|:)/.test(body) ? 'text/event-stream' : 'application/json' },
    });
  };
}
