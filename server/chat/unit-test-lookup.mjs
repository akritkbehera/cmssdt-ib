import { buildSearchArgs } from './templates.mjs';
import { validateToolArguments } from './tool-runtime.mjs';

export const UNIT_TEST_TOOL = { type: 'function', function: {
  name: 'lookup_unit_test_records',
  description: 'Read unit-test records for one exact release and architecture. Use ListIndexTool to find a concrete cmssdt-ibs index first. This tool verifies the mapping and returns raw statuses; confirm status semantics before labeling failures.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['index', 'release', 'architecture'],
    properties: {
      index: { type: 'string', pattern: '^cmssdt-ibs-[0-9]+(?:-[0-9]+)*$' },
      release: { type: 'string', pattern: '^CMSSW_[A-Z0-9_]+_[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}$', maxLength: 120 },
      architecture: { type: 'string', pattern: '^[a-z0-9]+_[a-z0-9_]+_[a-z0-9]+$', maxLength: 80 },
    },
  },
} };

const issue = message => ({ isError: true, content: [{ type: 'text', text: message }] });

function exactField(properties, name) {
  const field = properties?.[name];
  if (field?.type === 'keyword') return name;
  const keyword = Object.entries(field?.fields || {}).find(([, spec]) => spec.type === 'keyword');
  return keyword ? `${name}.${keyword[0]}` : null;
}

export async function lookupUnitTestRecords(session, searchSchema, args) {
  if (!validateToolArguments(UNIT_TEST_TOOL.function.parameters, args).ok) return issue('Invalid unit-test lookup arguments.');
  const { index, release, architecture } = args;
  const mapping = await session.callTool('IndexMappingTool', { index });
  if (mapping.isError) return mapping;
  let document;
  try { document = JSON.parse(mapping.content?.find(part => part.type === 'text')?.text); }
  catch { return issue('Could not read the mapping for the selected unit-test index.'); }
  const properties = document?.[index]?.mappings?.properties ?? document?.mappings?.properties ?? document?.properties;
  const releaseField = exactField(properties, 'release');
  const archField = exactField(properties, 'architecture');
  if (!releaseField || !archField || !properties?.name || !properties?.status) {
    return issue('Mapping did not confirm test name, status, and exact-match release and architecture fields.');
  }
  const body = {
    size: 25,
    track_total_hits: true,
    _source: ['release', 'architecture', 'name', 'package', 'status'],
    query: { bool: { filter: [{ term: { [releaseField]: release } }, { term: { [archField]: architecture } }] } },
  };
  const search = buildSearchArgs(searchSchema, { index, body });
  if (!search || !validateToolArguments(searchSchema, search).ok) return issue('Search tool schema could not express the exact unit-test query.');
  const result = await session.callTool('SearchIndexTool', search);
  if (result.isError) return result;
  return { ...result, content: [{ type: 'text', text: `Index: ${index}. Up to 25 records. Check the reported total or verify coverage before claiming completeness. Status semantics need independent confirmation.` }, ...(result.content || [])] };
}
