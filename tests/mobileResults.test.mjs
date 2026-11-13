import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

let server, ComparisonTable, Context, inspectResult, ArchitectureHeader;
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
  ArchitectureHeader = (await server.ssrLoadModule('/src/Components/common/ArchitectureHeader.js')).default;
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
function render(active = true, resultFilter = 'all') {
  return renderToStaticMarkup(React.createElement(Context.Provider, { value: {
    getActiveArchsForQue: () => ({ os: active ? ['el9'] : [], cpu: ['amd64', 'aarch64'], compiler: ['gcc14'] })
  } }, React.createElement(ComparisonTable, { data: [build], resultFilter, releaseQue: 'CMSSW_20_1_X' })));
}
test('phone view shows only the selected configuration with the same stage results', () => {
  const previousWindow = globalThis.window;
  let html;
  try {
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    html = render();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  const phone = html.slice(html.indexOf('<div class="ib-phone-results'), html.indexOf('<div class="ib-comparison-matrix')).split('<div class="ib-snap-slide" aria-hidden="true"')[0];
  assert.equal((phone.match(/scope="row"/g) || []).length, 2);
  assert.match(phone, /ib-family-header/);
  assert.equal((phone.match(/class="ib-config-field"/g) || []).length, 3);
  assert.match(phone, /aria-label="Build"/);
  assert.match(phone, /aria-label="Unit tests"/);
  assert.match(phone, /ib-phone-stage-icon/);
  assert.doesNotMatch(phone, /aarch64|Build or tests failed/);
  assert.match(html, /Compare configurations/);
  assert.equal((html.match(/<option /g) || []).length, 2);
  assert.equal((html.match(/class="ib-configuration-column"/g) || []).length, 2);
  assert.match(html, /class="ib-stage-column"/);
  assert.match(html, /colSpan="2"/i);
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

test('header-controlled filter emphasizes issues without restoring the removed summary row', () => {
  const html = render(true, 'issues');
  assert.doesNotMatch(html, /Stage results|ib-matrix-toolbar|ib-build-summary/);
  assert.match(html, /class="visually-hidden" role="status"/);
  const cells = html.match(/<td[^>]*ib-result-cell[^>]*>[\s\S]*?<\/td>/g) || [];
  const emphasized = cells.filter(cell => cell.includes('data-muted="false"'));
  assert.equal(emphasized.length, 1);
  assert.match(emphasized[0], /ib-status-danger/);
  assert.ok(cells.some(cell => cell.includes('data-muted="true"') && cell.includes('ib-status-success')));
});

test('compact configuration highlights follow configured production colors, not visible-column frequency', () => {
  const productionColor = '#5cb85c';
  const colors = { el9: productionColor, amd64: productionColor, gcc14: productionColor };
  const header = architecture => renderToStaticMarkup(React.createElement(ArchitectureHeader, { architecture, colors, productionColor, status: 'warnings' }));
  const standard = header('el9_amd64_gcc14');
  assert.equal((standard.match(/ib-config-value is-default/g) || []).length, 3);
  assert.match(standard, /Default configuration/);
  assert.match(standard, /Build status: Warnings/);
  assert.doesNotMatch(standard, /ib-config-status|ib-architecture-toolchain/);
  const alternate = header('el9_aarch64_gcc15');
  assert.equal((alternate.match(/ib-config-value is-default/g) || []).length, 1);
  assert.doesNotMatch(alternate, /Default configuration/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ArchitectureHeader, { architecture: 'el9_amd64_gcc14' })), /ib-config-value is-default/);
});

test('expanded matrices expose stage row headings and configuration column headings', () => {
  const html=render();
  const matrix=html.slice(html.indexOf('<div class="ib-comparison-matrix'));
  assert.match(matrix, /<th[^>]*scope="row"[^>]*>[\s\S]*?Build/);
  assert.match(matrix, /<th[^>]*scope="col"[^>]*class="ib-config-header/);
});

test('architecture descriptions remain accessible without a duplicate native tooltip', () => {
  const html=renderToStaticMarkup(React.createElement(ArchitectureHeader,{architecture:'el9_amd64_gcc14',status:'warnings',showNativeTooltip:false}));
  assert.match(html,/aria-label="el9_amd64_gcc14/);
  assert.doesNotMatch(html,/ title=/);
});
