import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Versioned, read-only dataset registry. This file is loaded once at backend
// startup and never written at runtime. It maps logical dataset names and
// aliases to an index family and a logical-to-source field mapping that was
// observed in an export, not read from a live mapping. Verification status is
// therefore explicit: a field mapping confirms how to query a field, never
// what a value means.
export const DATASET_REGISTRY_VERSION = 1;
export const DATASET_REGISTRY_PATH = fileURLToPath(new URL('./dataset-registry.json', import.meta.url));

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = value => typeof value === 'string' && value.trim().length > 0;

// Deterministic resolution: trim, collapse internal whitespace, then compare
// case-insensitively. No fuzzy matching, substring matching or release parsing.
export function normalizeDatasetKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function validateDatasetRegistry(raw) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!isPlainObject(raw)) {
    throw new Error('Invalid dataset registry: the document must be a JSON object.');
  }
  if (raw.version !== DATASET_REGISTRY_VERSION) {
    fail(`version must be ${DATASET_REGISTRY_VERSION}, received ${JSON.stringify(raw.version)}.`);
  }
  if (!Array.isArray(raw.datasets) || raw.datasets.length === 0) {
    fail('datasets must be a non-empty array.');
  }

  const seenKeys = new Map();
  const seenAliases = new Map();
  for (const [index, dataset] of (Array.isArray(raw.datasets) ? raw.datasets : []).entries()) {
    const where = `datasets[${index}]`;
    if (!isPlainObject(dataset)) { fail(`${where} must be an object.`); continue; }

    if (!nonEmptyString(dataset.key)) fail(`${where}.key must be a non-empty string.`);
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dataset.key)) fail(`${where}.key must be a lowercase hyphenated identifier.`);
    else {
      const key = normalizeDatasetKey(dataset.key);
      if (seenKeys.has(key)) fail(`${where}.key duplicates normalized key "${key}".`);
      else seenKeys.set(key, where);
    }

    if (!nonEmptyString(dataset.cluster)) fail(`${where}.cluster must be a non-empty string.`);
    if (!nonEmptyString(dataset.index_family)) fail(`${where}.index_family must be a non-empty string.`);

    if (!Array.isArray(dataset.aliases) || dataset.aliases.length === 0) fail(`${where}.aliases must be a non-empty array.`);
    else {
      const local = new Set();
      for (const [position, alias] of dataset.aliases.entries()) {
        if (!nonEmptyString(alias)) { fail(`${where}.aliases[${position}] must be a non-empty string.`); continue; }
        const normalized = normalizeDatasetKey(alias);
        if (local.has(normalized)) fail(`${where}.aliases[${position}] duplicates normalized alias "${normalized}" in the same dataset.`);
        local.add(normalized);
        if (seenAliases.has(normalized)) fail(`${where}.aliases[${position}] duplicates normalized alias "${normalized}" from ${seenAliases.get(normalized)}.`);
        else seenAliases.set(normalized, where);
      }
    }

    if (!isPlainObject(dataset.fields) || Object.keys(dataset.fields).length === 0) fail(`${where}.fields must be a non-empty object.`);
    else {
      for (const [logical, source] of Object.entries(dataset.fields)) {
        if (!nonEmptyString(logical)) fail(`${where}.fields has an empty logical field name.`);
        if (!nonEmptyString(source)) fail(`${where}.fields.${logical} must be a non-empty source field name.`);
      }
    }

    if (!isPlainObject(dataset.provenance) || !nonEmptyString(dataset.provenance.source)) {
      fail(`${where}.provenance.source must be a non-empty string.`);
    }
    if (!isPlainObject(dataset.verification) || !nonEmptyString(dataset.verification.status)) {
      fail(`${where}.verification.status must be a non-empty string.`);
    } else {
      for (const flag of ['mapping_confirmed', 'status_semantics_confirmed']) {
        if (typeof dataset.verification[flag] !== 'boolean') fail(`${where}.verification.${flag} must be a boolean.`);
      }
    }
  }

  // A dataset key must not also be an alias: resolution is exact, and an
  // ambiguous name would make the result depend on lookup order.
  for (const [key, keyWhere] of seenKeys) {
    if (seenAliases.has(key)) fail(`${keyWhere}.key collides with the normalized alias "${key}" declared by ${seenAliases.get(key)}.`);
  }

  if (errors.length) throw new Error(`Invalid dataset registry: ${errors.join(' ')}`);
  return freeze(raw);
}

async function readRegistry(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid dataset registry: could not read ${path}: ${error.message}`);
  }
  return validateDatasetRegistry(parsed);
}

let cached;

// Memoized so the registry is read and validated exactly once per process.
export function loadDatasetRegistry(path = DATASET_REGISTRY_PATH) {
  if (path !== DATASET_REGISTRY_PATH) return readRegistry(path);
  if (!cached) {
    cached = readRegistry(path).catch(error => { cached = undefined; throw error; });
  }
  return cached;
}

export function resolveDataset(registry, input) {
  const normalized = normalizeDatasetKey(input);
  const datasets = registry?.datasets || [];
  const match = normalized
    ? datasets.find(dataset => normalizeDatasetKey(dataset.key) === normalized
      || (Array.isArray(dataset.aliases) && dataset.aliases.some(alias => normalizeDatasetKey(alias) === normalized)))
    : undefined;

  if (!match) {
    return {
      status: 'unresolved',
      input: typeof input === 'string' ? input : null,
      reason: 'no_registered_dataset_match',
      guidance: 'No registered dataset matches this input. Use ListIndexTool to discover candidate indices and IndexMappingTool to verify field names and types before querying. A CMSSW release identifier is not a dataset key.',
    };
  }

  return {
    status: 'resolved',
    dataset: {
      key: match.key,
      cluster: match.cluster,
      index_family: match.index_family,
      aliases: match.aliases,
      fields: match.fields,
      provenance: match.provenance,
      verification: match.verification,
    },
  };
}

// Read-only tool exposed alongside the existing MCP, PPL and webpage tools.
export const RESOLVE_DATASET_TOOL_NAME = 'resolve_dataset';
export const RESOLVE_DATASET_TOOL = {
  type: 'function',
  function: {
    name: RESOLVE_DATASET_TOOL_NAME,
    description: 'Resolve a covered dataset question to its registry entry before guessing OpenSearch index or field names. '
      + 'Pass a logical dataset key or alias (for example "unit-test-results" or "unit tests"). Returns the matching '
      + 'cluster, index family, logical-to-source field mapping and verification status, or an explicit unresolved result. '
      + 'A CMSSW release identifier by itself is not a dataset key. The registry is guidance, not live evidence: discover '
      + 'the concrete index with ListIndexTool and verify mapping types with IndexMappingTool before choosing exact filters, '
      + 'and preserve the exact release and architecture from the user\'s question. A field mapping only confirms how to '
      + 'query a field; it does not confirm what a status value means. Only producer documentation or a known failed test '
      + 'can confirm that status 1 means failure.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Logical dataset key or alias, such as "unit-test-results" or "unit tests".' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
};

export function resolveDatasetTool(registry, args = {}) {
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(resolveDataset(registry, args.key)) }],
  };
}
