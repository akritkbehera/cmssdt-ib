import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupUnitTestRecords } from '../server/chat/unit-test-lookup.mjs';

const args = { index: 'cmssdt-ibs-2968', release: 'CMSSW_20_1_X_2026-11-17-2300', architecture: 'el8_amd64_gcc14' };
const schema = { type: 'object', properties: { index: { type: 'string' }, query: { type: 'object' } } };
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const properties = { release: { type: 'text', fields: { raw: { type: 'keyword' } } }, architecture: { type: 'keyword' },
  name: { type: 'keyword' }, status: { type: 'integer' } };

test('lookup checks the mapping and uses exact fields without assuming a failure code', async () => {
  const calls = [];
  const session = { async callTool(name, input) {
    calls.push([name, input]);
    return name === 'IndexMappingTool' ? response({ [args.index]: { mappings: { properties } } }) : response([{ name: 'fixture', status: 1 }]);
  } };
  const result = await lookupUnitTestRecords(session, schema, args);
  assert.deepEqual(calls.map(([name]) => name), ['IndexMappingTool', 'SearchIndexTool']);
  assert.deepEqual(calls[1][1].query.query.bool.filter,
    [{ term: { 'release.raw': args.release } }, { term: { architecture: args.architecture } }]);
  assert.equal(calls[1][1].query.size, 25);
  assert.match(result.content[0].text, /independent confirmation/);
});

test('lookup rejects wildcard indices and stops on an unconfirmed exact-match mapping', async () => {
  const calls = [];
  const session = { async callTool(name) {
    calls.push(name);
    return response({ properties: { ...properties, release: { type: 'text' } } });
  } };
  assert.equal((await lookupUnitTestRecords(session, schema, { ...args, index: 'cmssdt-ibs-*' })).isError, true);
  assert.deepEqual(calls, []);
  assert.equal((await lookupUnitTestRecords(session, schema, args)).isError, true);
  assert.deepEqual(calls, ['IndexMappingTool']);
});
