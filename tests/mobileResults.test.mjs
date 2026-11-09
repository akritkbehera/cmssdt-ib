import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

let server, ComparisonTable, Context, inspectResult;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true },
    // Supply architecture preferences without starting the application's network loader.
    plugins: [{ name: 'test-architecture-context', enforce: 'pre', transform(code, id) {
      if (id.endsWith('/Utils/ajax.js')) return 'export const getMultipleFiles = () => Promise.resolve([]);';
      if (id.endsWith('/context/ShowArchContext.js')) return `import React from 'react'; export const TestContext=React.createContext(); export const useShowArch=()=>React.useContext(TestContext);`;
    } }]
  });
  ComparisonTable = (await server.ssrLoadModule('/src/Components/IBPageComponents/ComparisonTable.js')).default;
  Context = (await server.ssrLoadModule('/src/context/ShowArchContext.js')).TestContext;
  inspectResult = (await server.ssrLoadModule('/src/Components/common/ResultDetails.js')).inspectResult;
});
after(async () => { await server?.close(); });
const archs = ['el9_amd64_gcc14', 'el9_aarch64_gcc14'];
const build = {
  release_queue: 'CMSSW_20_1_X', release_name: 'CMSSW_20_1_X_2026-11-06-2300',
  compared_tags: 'previous-->current', tests_archs: archs,
  builds: archs.map((arch, index) => ({ arch, passed: index ? 'error' : 'passed', done: true,
    file: 'not-ready', details: { compError: index ? 3 : 0 } })),
  utests: archs.map(arch => ({ arch, passed: 'passed', done: true, details: { num_passed: 10 }, file: 'not-ready' }))
};
function render(active = true) {
  return renderToStaticMarkup(React.createElement(Context.Provider, { value: {
    getActiveArchsForQue: () => ({ os: active ? ['el9'] : [], cpu: ['amd64', 'aarch64'], compiler: ['gcc14'] })
  } }, React.createElement(ComparisonTable, { data: [build], releaseQue: 'CMSSW_20_1_X' })));
}
test('phone view shows only the selected configuration with the same stage results', () => {
  const html = render();
  const phone = html.slice(html.indexOf('<div class="ib-phone-results'), html.indexOf('<div class="ib-comparison-matrix'));
  assert.equal((phone.match(/class="ib-phone-stage"/g) || []).length, 2);
  assert.match(phone, /Build<\/dt>/);
  assert.match(phone, /Unit tests<\/dt>/);
  assert.doesNotMatch(phone, /aarch64|Build or tests failed/);
  assert.match(html, /Compare configurations/);
  assert.equal((html.match(/<option /g) || []).length, 2);
  assert.match(html, /ib-config-failed/); // Full comparison still includes the other configuration.
});
test('empty architecture preferences produce a useful empty phone state', () => {
  const html = render(false);
  assert.match(html, /No configurations selected/);
  assert.match(html, /Select architectures to see results/);
});
test('touch inspection extracts the exact original URL and accessible partial result', () => {
  const url = 'https://example.test/logs?arch=el9_amd64_gcc14&failed=1';
  const marker = React.createElement('span', { 'data-result-status': 'danger', 'aria-label': 'Running — failures detected. 3 errors' });
  assert.deepEqual(inspectResult(React.createElement('a', { href: url }, marker)), {
    href: url, label: 'Running — failures detected. 3 errors'
  });
  assert.deepEqual(inspectResult(null), { href: undefined, label: 'View result details' });
});
