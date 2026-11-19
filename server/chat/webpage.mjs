const dashboard = 'https://akritkbehera.github.io';
const reports = 'https://cmssdt.cern.ch';
const cmsPages = 'https://cms-sw.github.io';

export const WEBPAGE_TOOL = { type: 'function', function: {
  name: 'read_ib_webpage',
  description: 'Read a CMS integration-build report, log, or published data URL over HTTPS. Supply a URL from the user or from a previous tool result. Returns text and approved links you can follow with another call. Use evidence from pages to identify releases, architectures and tests for subsequent OpenSearch queries. The dashboard itself is https://akritkbehera.github.io/cmssdt-ib/ and live summaries are at https://cmssdt.cern.ch/SDT/html/data/LatestIBsSummary.json. JavaScript is not run. Use offset to read further, or find to locate a literal within a report.',
  parameters: { type: 'object', additionalProperties: false, required: ['url'], properties: {
    url: { type: 'string', maxLength: 1800 },
    offset: { type: 'integer', minimum: 0, maximum: 2000000 },
    find: { type: 'string', minLength: 1, maxLength: 160 },
  } },
} };

function approvedUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { return null; }
  if (url.username || url.password || /%(?:25|2e|2f|5c|00)/i.test(url.pathname)) return null;
  const path = url.pathname;
  const allowed = (url.origin === dashboard && (path === '/cmssdt-ib' || path.startsWith('/cmssdt-ib/')))
    || (url.origin === reports && /^\/SDT\/(?:html\/data\/|public\/cms-sw\.github\.io\/data\/|jenkins-artifacts\/|cgi-bin\/(?:buildlogs\/|showBuildLogs\.py\/|showAddOnLogs\.py\/|newQA\.py$))/.test(path))
    || (url.origin === cmsPages && /^\/(?:[\w-]+\.html|[\w-]+\.json|data\/.*)?$/.test(path));
  if (!allowed) return null;
  url.hash = '';
  return url.href;
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = text => text.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, key) => key === '#39' ? "'" : entities[key]);
const plain = text => decode(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const result = (data, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify(data) }] });

export async function readIbWebpage({ url, offset = 0, find }, { signal, fetchPage = fetch } = {}) {
  let source = approvedUrl(url);
  if (!source) return result({ error: 'URL is outside the approved CMS IB pages and report paths.' }, true);
  const timeout = AbortSignal.timeout(15000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetchPage(source, { method: 'GET', redirect: 'manual', signal: deadline });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      const next = location && approvedUrl(location, source);
      if (!next || redirects === 3) return result({ source, error: 'Report redirected outside approved pages or exceeded the redirect limit.' }, true);
      source = next;
    }
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !/^(?:text\/(?:html|plain|csv)|application\/(?:json|xhtml\+xml))(?:\s*;|$)/i.test(type) || !response.body) {
      await response.body?.cancel();
      return result({ source, error: 'Page is unavailable or is not a supported text report.', status: response.status }, true);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const maxBytes = 2000000;
    let bytes = 0, body = '', inputTruncated = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = maxBytes - bytes;
        body += decoder.decode(value.subarray(0, remaining), { stream: true });
        bytes += value.byteLength;
        if (bytes > maxBytes) { inputTruncated = true; break; }
      }
      body += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    const links = new Map();
    if (/html/i.test(type)) {
      body = body.replace(/<!--[^]*?(?:-->|$)|<(script|style|template)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, '');
      for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
        const link = approvedUrl(decode(match[1] ?? match[2] ?? match[3]), source);
        if (link && !links.has(link) && link.length <= 400) links.set(link, plain(body.slice(match.index + match[0].length, match.index + match[0].length + 100).split('<')[0]));
        if (links.size === 8) break;
      }
      body = body.replace(/<\/(?:tr|p|li|div|h[1-6]|pre)>|<br\s*\/?>/gi, '\n').split('\n').map(plain).filter(Boolean).join('\n');
    }
    const match = find ? body.toLowerCase().indexOf(find.toLowerCase(), offset) : -1;
    const start = match >= 0 ? Math.max(offset, match - 400) : offset;
    const excerpt = find && match < 0 ? '' : body.slice(start, start + 4500);
    return result({ source, text: excerpt, links: [...links].map(([url, label]) => ({ url, label })),
      offset: start, nextOffset: excerpt && start + excerpt.length < body.length ? start + excerpt.length : null,
      inputTruncated, ...(find ? { found: match >= 0 } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    return result({ source, error: timeout.aborted ? 'Page request timed out.' : 'Page could not be read.' }, true);
  }
}
