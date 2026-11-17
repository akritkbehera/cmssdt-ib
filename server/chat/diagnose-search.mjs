import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { openMcp, discoverTools } from './mcp.mjs';
import { buildSearchArgs, validateToolArguments } from './templates.mjs';
import { sanitizeSecrets } from './diagnostics.mjs';

export function summarizeResult(result) {
  const text = result?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') || '';
  let payload = result?.structuredContent;
  if (!payload) try { payload = JSON.parse(text); } catch { /* Some native tools return lists or plain text. */ }
  return { toolError: Boolean(result?.isError), empty: !text.trim() && !payload,
    shape: Array.isArray(payload) ? 'array' : payload ? 'object' : 'text',
    keys: payload && !Array.isArray(payload) ? Object.keys(payload).slice(0, 12) : [],
    documentsReturned: Array.isArray(payload) ? payload.length : payload?.hits?.hits?.length ?? null,
    aggregationsPresent: Boolean(payload?.aggregations),
    ...(result?.isError ? { error: sanitizeSecrets(text).slice(0, 1000) } : {}) };
}

// No model calls, cluster writes, registration changes, or credential output.
// Direct client calls deliberately avoid automatic recovery to expose the first error.
export async function diagnoseSearch({ config, release, index, write = console.log }) {
  if (!/^CMSSW_\d+_\d+_[A-Z0-9_]+_\d{4}-\d{2}-\d{2}-\d{4}$/.test(release || '')) throw new Error('Provide an exact IB release label.');
  if (!/^cmssdt-[a-z0-9_-]+$/.test(index || '')) throw new Error('Provide one concrete CMSSDT index; wildcards are not allowed in this diagnostic.');
  if (!config.kerberosCache) throw new Error('Run inside the deployed Kerberos-enabled backend container.');
  const signal = AbortSignal.timeout(120000);
  let client;
  try {
    client = await openMcp(config, signal);
    const tools = await discoverTools(client, signal);
    const schemas = Object.fromEntries(tools.map(tool => [tool.function.name, tool.function.parameters]));
    write(JSON.stringify({ stage: 'tools/list', ok: true, tools: Object.keys(schemas), searchSchema: schemas.SearchIndexTool }));
    async function probe(stage, tool, args, expectAggregations = false) {
      if (!args || !schemas[tool] || !validateToolArguments(schemas[tool], args).ok) {
        write(JSON.stringify({ stage, skipped: true, reason: 'Discovered schema cannot express this bounded probe.' })); return;
      }
      const started = Date.now();
      try {
        const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal, timeout: 30000 });
        const summary = summarizeResult(result);
        write(JSON.stringify({ stage, durationMs: Date.now() - started,
          ok: !summary.toolError && !summary.empty && (!expectAggregations || summary.aggregationsPresent), ...summary }));
      } catch (error) {
        write(JSON.stringify({ stage, ok: false, code: error.code, durationMs: Date.now() - started,
          error: sanitizeSecrets(String(error.message || error)).slice(0, 1200) }));
      }
    }
    const mapping = schemas.IndexMappingTool?.properties;
    await probe('mapping', 'IndexMappingTool', mapping?.index ? { index } : mapping?.indices ? { indices: [index] } : null);
    const filter = { term: { release } };
    const search = body => buildSearchArgs(schemas.SearchIndexTool, { index, body });
    await probe('document-search', 'SearchIndexTool', search({ size: 1, query: filter, _source: ['release', 'architecture', 'workflow', 'step', 'exitcode'] }));
    const aggregation = search({ size: 0, query: filter, aggs: { by_architecture: { terms: { field: 'architecture', size: 10 } } } });
    await probe('aggregation', 'SearchIndexTool', aggregation, true);
    const raw = schemas.SearchIndexTool?.properties?.return_raw_response;
    if (aggregation && raw) await probe('aggregation-raw', 'SearchIndexTool', { ...aggregation,
      return_raw_response: raw.type === 'string' ? 'true' : true }, true);
  } finally { await client?.close().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  diagnoseSearch({ config: loadConfig(), release: process.argv[2], index: process.argv[3] }).catch(error => {
    console.error(sanitizeSecrets(String(error.message || error))); process.exitCode = 1;
  });
}
