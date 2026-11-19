import assert from 'node:assert/strict';
import test from 'node:test';
import { readIbWebpage } from '../server/chat/webpage.mjs';

const url = 'https://cmssdt.cern.ch/SDT/cgi-bin/buildlogs/report.html';
const parse = result => JSON.parse(result.content[0].text);

test('extracts report evidence and followable CMS links without running page code', async () => {
  const result = await readIbWebpage({ url, find: 'failed' }, { fetchPage: async (_, init) => {
    assert.equal(init.redirect, 'manual');
    assert.equal(init.method, 'GET');
    return new Response('<script>ignore me</script><h1>Test failed</h1><a href="test.log">Log</a><a href="https://evil.example/">Outside</a>', {
      headers: { 'content-type': 'text/html' },
    });
  } });
  assert.match(parse(result).text, /Test failed/);
  assert.doesNotMatch(parse(result).text, /ignore me/);
  assert.deepEqual(parse(result).links, [{ url: new URL('test.log', url).href, label: 'Log' }]);
});

test('rejects disallowed URLs and checks redirect targets before requesting them', async () => {
  let calls = 0;
  const fetchPage = async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } });
  };
  assert.equal((await readIbWebpage({ url: 'https://cmssdt.cern.ch@evil.example/' }, { fetchPage })).isError, true);
  assert.equal((await readIbWebpage({ url }, { fetchPage })).isError, true);
  assert.equal(calls, 1);
});
