import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, copyFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nullDiagnostics } from './diagnostics.mjs';

// Persistent, backend-managed knowledge registry. It stores verified
// structural knowledge only: MCP tool schemas, index families, compact field
// summaries, bound field roles and query-template validation state. It never
// stores credentials, user data, conversation text or query result payloads.
// Shared across users; per-user authorization is always enforced by the live
// OpenSearch identity, never by this registry.
export const REGISTRY_VERSION = 2;
const FILE = 'registry.json', BAK = 'registry.json.bak';

const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const hashOf = value => createHash('sha256').update(stable(value)).digest('hex').slice(0, 32);
const nowIso = () => new Date().toISOString();
const isStale = (family, now) => Boolean(family?.expiresAt && Date.parse(family.expiresAt) < now());

// Logical query roles bound to actual fields of a verified mapping. Candidate
// names are ordered; the first candidate that exists in the mapping wins.
// Candidates mirror the dashboard application schema and common OpenSearch
// conventions; nothing is assumed to exist until seen in a live mapping.
export const ROLE_CANDIDATES = {
  release: ['release_name', 'release', 'build_name', 'ib_name', 'name'],
  queue: ['release_queue', 'queue', 'series', 'release_series'],
  flavour: ['flavour', 'flavor', 'variant', 'build_variant'],
  arch: ['arch', 'architecture', 'tests_archs'],
  timestamp: ['ib_date', 'timestamp', '@timestamp', 'build_date', 'created_at', 'date'],
  status: ['status', 'state', 'result'],
  passed: ['passed', 'success', 'ok'],
  done: ['done', 'finished', 'completed'],
  exitcode: ['exitcode', 'exit_code', 'exitCode'],
  workflow: ['workflowName', 'workflow_name', 'workflow'],
  workflowId: ['workflowID', 'workflow_id', 'workflowId', 'id'],
  test: ['test_name', 'test', 'unit_test', 'name'],
  package: ['package', 'category', 'component'],
};

// Parse the shapes a mapping may arrive in (OpenSearch get-index mappings, or
// an MCP IndexMappingTool text payload). Returns null when nothing matches:
// we never invent schema that was not observed.
export function parseMapping(payload) {
  const objects = [];
  const walk = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    objects.push(value);
    for (const nested of Object.values(value)) if (nested && typeof nested === 'object') walk(nested);
  };
  walk(payload);
  for (const candidate of objects) {
    const properties = candidate.mappings?.properties || candidate.properties ||
      candidate.mappings?.[Object.keys(candidate.mappings || {})[0]]?.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const sourceIndex = typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload).find(key => payload[key] === candidate || payload[key]?.mappings || payload[key]?.properties) || candidate.index || null
        : null;
      return { properties, sourceIndex };
    }
  }
  return null;
}

function summarizeProperties(properties, prefix = '', fields = {}, nested = []) {
  for (const [name, spec] of Object.entries(properties || {})) {
    if (!spec || typeof spec !== 'object') continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const type = spec.type || (spec.properties ? 'object' : undefined);
    if (!type) continue;
    const keyword = type === 'keyword' || Object.values(spec.fields || {}).some(sub => sub?.type === 'keyword');
    fields[path] = { type, ...(keyword ? { keyword: true } : {}), ...(spec.format ? { format: spec.format } : {}) };
    if (type === 'nested' || type === 'object') {
      nested.push(path);
      summarizeProperties(spec.properties, path, fields, nested);
    }
  }
  return { fields, nested };
}

function bindRoles(fields) {
  const roles = {};
  for (const [role, candidates] of Object.entries(ROLE_CANDIDATES)) {
    for (const candidate of candidates) {
      const field = fields[candidate];
      if (!field) continue;
      if (role === 'timestamp' && field.type !== 'date') continue;
      roles[role] = candidate;
      break;
    }
  }
  return roles;
}

// Index family detection: strip trailing numeric/date segments so one family
// covers per-build indices such as `cmssdt-ibs-2968` or dated rollovers.
export function familyPattern(name) {
  return String(name).replace(/[-_.]?(\d{4}-\d{2}-\d{2}|\d{6,}|\d+)$/, '') + '-*';
}

function migrate(doc) {
  const version = Number(doc?.version) || 1;
  const migrated = { version: REGISTRY_VERSION, updatedAt: nowIso(), tools: {}, families: [], indices: {}, templates: {} };
  if (version >= REGISTRY_VERSION) return doc;
  // v1 shape: { indices: { name: {...} }, templates: [...] }
  for (const [name, entry] of Object.entries(doc?.indices || {})) {
    if (entry && typeof entry === 'object') migrated.families.push({ id: familyPattern(name), ...entry });
  }
  for (const template of doc?.templates || []) if (template?.id) migrated.templates[template.id] = template;
  return migrated;
}

export function createRegistry({ dir = '', diagnostics = nullDiagnostics, now = Date.now } = {}) {
  let doc = migrate(null), persistent = Boolean(dir), queue = Promise.resolve();
  const path = dir && join(dir, FILE);
  const bakPath = dir && join(dir, BAK);
  const counters = { mappingHits: 0, mappingMisses: 0, toolHits: 0, toolMisses: 0, saves: 0, recoveries: 0 };

  // Updates are serialized through a promise chain and each save is atomic
  // (temp file + rename), so a crash never leaves a half-written registry.
  const flush = () => queue;
  const queueSave = () => { if (persistent) queue = queue.then(save).catch(() => {}); return queue; };
  async function save() {
    if (!persistent) return;
    try {
      await mkdir(dir, { recursive: true });
      const tmp = `${path}.tmp-${now()}`;
      await writeFile(tmp, JSON.stringify(doc), { mode: 0o640 });
      await copyFile(path, bakPath).catch(() => {});
      await rename(tmp, path);
      counters.saves += 1;
    } catch (error) {
      persistent = false; // Read-only volume or disk trouble: keep serving from memory.
      diagnostics.log('registry_unavailable', { stage: 'persist', errorKind: String(error?.code || error?.name || 'error') });
    }
  }
  async function load() {
    if (!dir) return doc;
    for (const file of [FILE, BAK]) {
      try {
        const parsed = JSON.parse(await readFile(join(dir, file), 'utf8'));
        doc = migrate(parsed);
        if (file === BAK) counters.recoveries += 1;
        return doc;
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        counters.recoveries += 1;
      }
    }
    // Preserve a corrupt file for inspection instead of overwriting evidence.
    await readdir(dir).catch(() => []).then(names => Promise.all(names.filter(name => name === FILE)
      .map(name => rename(join(dir, name), join(dir, `${name}.corrupt-${now()}`)).catch(() => {}))));
    doc = migrate(null);
    diagnostics.log('registry_recovered', { stage: 'load', detail: 'started_empty_after_corruption' });
    return doc;
  }

  const findFamily = id => doc.families.find(family => family.id === id || family.sourceIndex === id);

  return {
    get persistent() { return persistent; },
    counters, flush, load,
    get document() { return doc; },

    recordTools(endpoint, tools) {
      const summary = tools.map(tool => ({ name: tool.function?.name || tool.name, description: tool.function?.description || tool.description,
        inputSchema: tool.function?.parameters || tool.inputSchema || { type: 'object' } }));
      const fingerprint = hashOf(summary);
      if (doc.tools[endpoint]?.fingerprint === fingerprint) return doc.tools[endpoint]; // unchanged: no write
      doc.tools[endpoint] = { fingerprint, tools: summary, discoveredAt: nowIso() };
      queueSave();
      return doc.tools[endpoint];
    },
    getTools(endpoint) {
      const entry = doc.tools[endpoint];
      if (!entry) { counters.toolMisses += 1; return undefined; }
      counters.toolHits += 1;
      return entry;
    },

    recordIndices(names) {
      const grouped = {};
      for (const name of names.slice(0, 500)) grouped[familyPattern(name)] = (grouped[familyPattern(name)] || 0) + 1;
      doc.indices = { names: names.slice(0, 500), families: grouped, recordedAt: nowIso() };
      for (const pattern of Object.keys(grouped)) if (!findFamily(pattern)) {
        doc.families.push({ id: pattern, pattern, sourceIndex: null, fingerprint: null, fields: {}, roles: {},
          discoveredAt: nowIso(), lastValidatedAt: null, expiresAt: null });
      }
      queueSave();
      return doc.families;
    },

    recordMapping({ index, mapping }) {
      const parsed = parseMapping(mapping);
      if (!parsed) { counters.mappingMisses += 1; return null; }
      const { fields, nested } = summarizeProperties(parsed.properties);
      const fingerprint = hashOf(parsed.properties);
      const id = familyPattern(parsed.sourceIndex || index || 'unknown');
      let family = findFamily(id) || findFamily(index);
      if (!family) {
        family = { id, pattern: id, discoveredAt: nowIso() };
        doc.families.push(family);
      }
      Object.assign(family, { sourceIndex: parsed.sourceIndex || index || family.sourceIndex, fingerprint,
        fields, nested, roles: bindRoles(fields), updatedAt: nowIso(),
        expiresAt: new Date(now() + 24 * 3600000).toISOString(), lastValidatedAt: family.lastValidatedAt || null });
      counters.mappingHits += 1;
      queueSave();
      return family;
    },

    // A mapping (and templates validated against it) is verified whenever a
    // real query against the matching fingerprint succeeds.
    touchValidation({ index, familyId, fingerprint }) {
      const family = findFamily(familyId || familyPattern(index)) || findFamily(index);
      if (!family || (fingerprint && family.fingerprint && fingerprint !== family.fingerprint)) return null;
      family.lastValidatedAt = nowIso();
      queueSave();
      return family;
    },

    recordTemplateValidation(templateId, { familyId, fingerprint, ok }) {
      doc.templates[templateId] = { ...(doc.templates[templateId] || {}), familyId, fingerprint,
        ok: Boolean(ok), validatedAt: ok ? nowIso() : (doc.templates[templateId]?.validatedAt || null), failedAt: ok ? null : nowIso() };
      queueSave();
      return doc.templates[templateId];
    },
    templateStatus(templateId, family) {
      const entry = doc.templates[templateId];
      if (!entry?.ok) return 'unvalidated';
      if (family?.fingerprint && entry.fingerprint && entry.fingerprint !== family.fingerprint) return 'stale';
      return 'validated';
    },

    isStale(family) { return isStale(family, now); },

    // Compact, deterministic summary for LLM context. Bounded in size; only
    // structural facts observed in live mappings, clearly dated.
    familySummary(familyId, { maxChars = 1400 } = {}) {
      const family = findFamily(familyId);
      if (!family || !family.fields) return '';
      const roleLines = Object.entries(family.roles).map(([role, field]) => `${role}=${field}(${family.fields[field]?.type})`);
      const dateFields = Object.entries(family.fields).filter(([, spec]) => spec.type === 'date').map(([name, spec]) => `${name}${spec.format ? `(${spec.format})` : ''}`);
      const keywordFields = Object.entries(family.fields).filter(([, spec]) => spec.keyword).map(([name]) => name).slice(0, 12);
      const textFields = Object.entries(family.fields).filter(([, spec]) => spec.type === 'text').map(([name]) => name).slice(0, 8);
      const lines = [
        `Index family ${family.id} (source ${family.sourceIndex || 'unknown'}), schema fingerprint ${family.fingerprint || 'unset'}, mapping seen ${family.updatedAt || family.discoveredAt}, last query-validated ${family.lastValidatedAt || 'never'}${isStale(family, now) ? ' STALE: refresh mapping before freshness claims' : ''}.`,
        `Field roles: ${roleLines.join(', ') || 'none bound'}.`,
        dateFields.length ? `Date fields: ${dateFields.join(', ')}.` : '',
        `Keyword fields (exact-match/filter): ${keywordFields.join(', ') || 'none observed'}. Text fields (full-text only): ${textFields.join(', ') || 'none observed'}.`,
        family.nested?.length ? `Nested/object paths: ${family.nested.join(', ')}.` : '',
      ].filter(Boolean);
      return lines.join('\n').slice(0, maxChars);
    },

    familyForQuestion(tokens) {
      // Deterministic relevance: family whose pattern tokens overlap the
      // question tokens (prefix match for plural forms), most overlap first;
      // ties keep registry order.
      let best = null, bestScore = 0;
      for (const family of doc.families) {
        const words = String(family.id).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        let score = 0;
        for (const token of tokens) if (words.some(word => word.startsWith(token) || token.startsWith(word))) score += 1;
        if (score > bestScore) { best = family; bestScore = score; }
      }
      return best;
    },

    sweep() {
      const cutoff = now() - 7 * 24 * 3600000;
      doc.families = doc.families.filter(family => !family.expiresAt || Date.parse(family.expiresAt) > cutoff);
      queueSave();
    },
  };
}
