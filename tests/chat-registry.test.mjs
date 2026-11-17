import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, parseMapping, familyPattern, REGISTRY_VERSION } from '../server/chat/registry.mjs';

async function dataDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cmssdt-registry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const MAPPING = { 'cmssdt-ibs-2968': { mappings: { properties: {
  release_name: { type: 'keyword' }, release_queue: { type: 'keyword' }, arch: { type: 'keyword' },
  ib_date: { type: 'date', format: 'yyyy-MM-dd-HHmm||strict_date_optional_time' },
  status: { type: 'keyword' }, done: { type: 'boolean' }, passed: { type: 'boolean' }, exitcode: { type: 'integer' },
  steps: { type: 'nested', properties: { name: { type: 'keyword' }, log: { type: 'text' } } },
} } } };

test('registry records structural knowledge with fingerprints and persists across restarts', async t => {
  const dir = await dataDir(t);
  const registry = createRegistry({ dir });
  await registry.load();
  registry.recordTools('https://os.example/mcp', [{ function: { name: 'SearchIndexTool', description: 'search', parameters: { type: 'object' } } }]);
  registry.recordIndices(['cmssdt-ibs-2967', 'cmssdt-ibs-2968']);
  const family = registry.recordMapping({ index: 'cmssdt-ibs-2968', mapping: MAPPING });
  assert.ok(family);
  assert.equal(family.roles.release, 'release_name');
  assert.equal(family.roles.arch, 'arch');
  assert.equal(family.roles.timestamp, 'ib_date');
  assert.equal(family.roles.exitcode, 'exitcode');
  assert.equal(family.fields.exitcode.type, 'integer');
  assert.equal(family.fields['steps.name'].type, 'keyword', 'nested fields are flattened with paths');
  assert.ok(family.fingerprint && family.expiresAt && family.discoveredAt);
  registry.touchValidation({ familyId: family.id, fingerprint: family.fingerprint });
  registry.recordTemplateValidation('latest-ib', { familyId: family.id, fingerprint: family.fingerprint, ok: true });
  await registry.flush();

  // "Redeploy": a fresh registry instance over the same volume.
  const restarted = createRegistry({ dir });
  await restarted.load();
  const restored = restarted.document.families.find(entry => entry.id === family.id);
  assert.ok(restored, 'families survive restart');
  assert.equal(restored.fingerprint, family.fingerprint, 'schema fingerprint survives restart');
  assert.ok(restored.lastValidatedAt, 'validation timestamp survives restart');
  assert.equal(restarted.templateStatus('latest-ib', restored), 'validated');
  assert.ok(restarted.getTools('https://os.example/mcp'), 'MCP tool schemas survive restart');
  const raw = JSON.stringify(restarted.document);
  assert.ok(!/Bearer|access_token|client_secret/i.test(raw), 'registry never stores credentials');
});

test('registry refuses to store result payloads or secrets in mapping summaries', () => {
  const registry = createRegistry({});
  registry.recordMapping({ index: 'cmssdt-ibs-1', mapping: MAPPING });
  const summary = registry.familySummary(familyPattern('cmssdt-ibs-1'));
  assert.ok(summary.includes('release=release_name(keyword)'));
  assert.ok(summary.includes('Date fields: ib_date'));
  assert.ok(summary.includes('last query-validated never'));
  assert.ok(summary.length < 1600, 'summaries are strictly bounded');
  assert.ok(!Object.keys(registry.document).some(key => /result|hits|documents|conversation|user/i.test(key)), 'no result or user data in the registry');
});

test('mappings that do not parse are ignored instead of guessed', () => {
  const registry = createRegistry({});
  assert.equal(parseMapping({ hello: 'world' }), null);
  assert.equal(registry.recordMapping({ index: 'x', mapping: { random: 42 } }), null);
  const direct = parseMapping({ properties: { a: { type: 'keyword' } } });
  assert.ok(direct && direct.properties.a.type === 'keyword');
  const wrapped = parseMapping({ mappings: { properties: { b: { type: 'date' } } } });
  assert.ok(wrapped && wrapped.properties.b.type === 'date');
});

test('corrupt registry recovers from backup, then starts empty with the corrupt file preserved', async t => {
  const dir = await dataDir(t);
  const registry = createRegistry({ dir });
  await registry.load();
  registry.recordIndices(['cmssdt-ibs-1']);
  await registry.flush(); // save 1: no previous state to back up
  registry.recordMapping({ index: 'cmssdt-ibs-1', mapping: MAPPING });
  await registry.flush(); // save 2: .bak now holds the save-1 state
  await writeFile(join(dir, 'registry.json'), 'CORRUPT{{{', 'utf8');
  const recovered = createRegistry({ dir });
  await recovered.load();
  assert.equal(recovered.document.families.length, 1, 'recovered from the good backup');
  await writeFile(join(dir, 'registry.json'), 'CORRUPT{{{', 'utf8');
  await writeFile(join(dir, 'registry.json.bak'), 'ALSO CORRUPT', 'utf8');
  const fresh = createRegistry({ dir });
  await fresh.load();
  assert.equal(fresh.document.version, REGISTRY_VERSION);
  assert.equal(fresh.document.families.length, 0, 'starts empty after unrecoverable corruption');
  const preserved = (await readdir(dir)).filter(name => name.startsWith('registry.json.corrupt-'));
  assert.ok(preserved.length, 'corrupt file preserved for inspection');
  fresh.recordIndices(['cmssdt-relvals-1']);
  await fresh.flush();
  assert.equal(JSON.parse(await readFile(join(dir, 'registry.json'), 'utf8')).families.length, 1, 'registry keeps working after recovery');
});

test('version migration upgrades legacy documents', async t => {
  const dir = await dataDir(t);
  await writeFile(join(dir, 'registry.json'), JSON.stringify({
    version: 1,
    indices: { 'cmssdt-ibs-7': { fields: { release_name: { type: 'keyword' } }, roles: { release: 'release_name' }, discoveredAt: '2026-01-01T00:00:00Z' } },
    templates: [{ id: 'latest-ib', ok: true }],
  }), 'utf8');
  const registry = createRegistry({ dir });
  await registry.load();
  assert.equal(registry.document.version, REGISTRY_VERSION);
  assert.equal(registry.document.families.length, 1);
  assert.equal(registry.document.families[0].id, familyPattern('cmssdt-ibs-7'));
  assert.equal(registry.document.templates['latest-ib'].ok, true);
});

test('an unwritable volume degrades to memory and the application keeps working', async t => {
  const dir = await dataDir(t);
  const locked = join(dir, 'locked');
  await mkdir(locked);
  await chmod(locked, 0o555);
  t.after(() => chmod(locked, 0o755).catch(() => {}));
  const registry = createRegistry({ dir: locked });
  await registry.load();
  registry.recordMapping({ index: 'cmssdt-ibs-2', mapping: MAPPING });
  registry.recordTemplateValidation('latest-ib', { ok: true });
  await registry.flush();
  assert.ok(registry.document.families.length === 1, 'in-memory registry continues serving');
  assert.equal(registry.persistent, false, 'persistence disabled after write failure');
  registry.recordIndices(['cmssdt-ibs-3']);
  await registry.flush(); // must not throw
});

test('staleness and validation policy: mappings expire, validated state tracks fingerprints', async t => {
  let clock = Date.parse('2026-11-17T00:00:00Z');
  const registry = createRegistry({ dir: '', now: () => clock });
  const family = registry.recordMapping({ index: 'cmssdt-ibs-5', mapping: MAPPING });
  assert.equal(registry.isStale(family), false);
  clock += 25 * 3600000;
  assert.equal(registry.isStale(family), true, 'mapping TTL is 24h');
  assert.ok(registry.familySummary(family.id).includes('STALE'), 'stale mappings are flagged in context');
  registry.recordTemplateValidation('latest-ib', { familyId: family.id, fingerprint: 'other-fingerprint', ok: true });
  assert.equal(registry.templateStatus('latest-ib', family), 'stale', 'templates validated on another schema generation are not trusted');
  registry.recordTemplateValidation('latest-ib', { familyId: family.id, fingerprint: family.fingerprint, ok: false });
  assert.notEqual(registry.templateStatus('latest-ib', family), 'validated', 'failed validation revokes trust');
  assert.equal(registry.templateStatus('unknown-template', family), 'unvalidated');
});

test('deterministic family relevance selection matches question tokens', () => {
  const registry = createRegistry({});
  registry.recordMapping({ index: 'cmssdt-ibs-1', mapping: MAPPING });
  registry.recordMapping({ index: 'cmssdt-relvals-1', mapping: { 'cmssdt-relvals-1': { mappings: { properties: {
    release_name: { type: 'keyword' }, workflowID: { type: 'integer' }, exitcode: { type: 'integer' } } } } } });
  const picked = registry.familyForQuestion(['relval', 'workflow', 'failures']);
  assert.ok(String(picked.id).includes('relval'));
  const build = registry.familyForQuestion(['ib', 'build', 'latest']);
  assert.ok(String(build.id).includes('ibs'));
});
