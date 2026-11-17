import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';

const engine = process.env.IB_BROWSER || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engine]).launch();
await mkdir('chat-review', { recursive: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage(), errors = [], requests = [];
    const wideTable = '| Release | Architecture | Package | Test | GPU | Timestamp (UTC) | Status | Index |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| `CMSSW_20_1_DEVEL_X_2026-11-15-2300` | `el9_amd64_gcc14` | CondTools/RunInfo | CondToolsLHCInfoNewPopConTest | NVIDIA_L4 | 2026-11-16 02:38:00 | failed | cmssdt-ibs-2968 |';
    let failNext = false, holdNext = false, release;
    page.on('pageerror', error => errors.push(error.message));
    // No build-data fixtures: /insights must load independently of monitoring.
    await page.route('**/api/chat/health', route => route.fulfill({ json: { ready: true, model: 'fixture-model' } }));
    await page.route('**/api/chat/connection', route => route.fulfill({ json: { connected: true, tools: ['ListIndexTool'], modelConfigured: true, verifiedAt: new Date().toISOString() } }));
    await page.route('**/api/chat', async route => {
      const body = route.request().postDataJSON(); requests.push(body);
      if (failNext) { failNext = false; await route.fulfill({ status: 503, json: { error: 'Fixture backend unavailable' } }); return; }
      if (holdNext) {
        holdNext = false;
        await new Promise(resolve => { release = resolve; });
        await route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"done"}\n' }).catch(() => {});
        return;
      }
      const text = body.messages.at(-1).content === 'Wide table' ? wideTable : body.messages.at(-1).content === 'Follow up' ? 'Follow-up answer using context.' : 'Fixture answer from cmssdt-ibs: **120 seconds**.';
      await route.fulfill({ contentType: 'application/x-ndjson', body: [
        { type: 'activity', text: 'Querying SearchIndexTool…' },
        { type: 'text', text }, { type: 'done' },
      ].map(event => JSON.stringify(event)).join('\n') + '\n' });
    });
    await page.goto('http://localhost:5174/#/insights');
    await page.getByRole('status').filter({ hasText: 'fixture-model' }).waitFor();
    await page.getByRole('button', { name: 'Test MCP connection', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'MCP tools/list verified' }).waitFor();
    const input = page.getByRole('textbox', { name: 'Ask about builds' });
    await input.fill('Build duration'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('120 seconds', { exact: true }).waitFor();
    await input.fill('Follow up'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Follow-up answer using context.').waitFor();
    assert.deepEqual(requests.at(-1).messages.map(message => message.role), ['user', 'assistant', 'user']);
    await input.fill('Wide table'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const tableRegion = page.getByRole('region', { name: 'Result table — scroll horizontally' });
    await tableRegion.waitFor();
    const dimensions = await tableRegion.evaluate(el => {
      const table = el.querySelector('table');
      return { overflow: el.scrollWidth > el.clientWidth, headerHeight: table.tHead.rows[0].getBoundingClientRect().height,
        rowHeight: table.tBodies[0].rows[0].getBoundingClientRect().height,
        firstCellVisible: table.rows[0].cells[0].getBoundingClientRect().left >= el.getBoundingClientRect().left };
    });
    assert.ok(dimensions.overflow, 'wide tables scroll within their own region');
    assert.ok(dimensions.firstCellVisible, 'first column is reachable without clipping');
    assert.ok(dimensions.headerHeight < 80 && dimensions.rowHeight < 80, 'timestamps never stack character by character');
    await tableRegion.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    assert.ok(await tableRegion.evaluate(el => el.scrollLeft > 0), 'table supports horizontal scrolling');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'wide results do not widen the page');
    await page.screenshot({ path: `chat-review/${engine}-table-${width}.png`, fullPage: true });
    await page.reload();
    await page.getByText('Follow-up answer using context.').waitFor();
    const freshTab = await context.newPage();
    await freshTab.route('**/api/chat/health', route => route.fulfill({ json: { ready: true, model: 'fixture-model' } }));
    await freshTab.goto('http://localhost:5174/#/insights');
    await freshTab.getByRole('heading', { name: 'Investigate your Integration Builds' }).waitFor();
    await freshTab.getByRole('button', { name: 'Build duration', exact: true }).click();
    await freshTab.getByText('Follow-up answer using context.').waitFor();
    await freshTab.close();
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByRole('heading', { name: 'Investigate your Integration Builds' }).waitFor();
    await input.fill('Independent question'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('120 seconds', { exact: true }).waitFor();
    assert.equal(requests.at(-1).messages.length, 1, 'new conversation does not send another conversation');
    holdNext = true;
    const started = page.waitForRequest(request => request.url().endsWith('/api/chat') && request.postDataJSON().messages.at(-1).content === 'Stop example');
    await input.fill('Stop example'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await started;
    await page.getByRole('button', { name: 'Stop response', exact: true }).click();
    release();
    await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Build duration', exact: true }).click();
    await page.getByText('Follow-up answer using context.').waitFor();
    page.once('dialog', dialog => dialog.accept('Saved investigation'));
    await page.getByRole('button', { name: 'Rename Build duration', exact: true }).click();
    await page.getByRole('button', { name: 'Saved investigation', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Connection', exact: true }).click();
    await page.getByLabel('Backend address', { exact: true }).fill('http://localhost:5174');
    await page.getByLabel('Backend access token', { exact: true }).fill('browser-backend-token');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('cmssdt-chat-backend')), 'http://localhost:5174');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cmssdt-chat-access')), null, 'access tokens are not persisted');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
    await page.screenshot({ path: `chat-review/${engine}-${width}.png`, fullPage: true });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete Saved investigation', exact: true }).click();
    await page.getByRole('button', { name: 'Saved investigation', exact: true }).waitFor({ state: 'detached' });
    failNext = true;
    await input.fill('Failure example'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Fixture backend unavailable' }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`${engine}: chat history, context, settings and responsive checks passed`);
