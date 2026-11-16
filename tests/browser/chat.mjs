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
    let failNext = false;
    page.on('pageerror', error => errors.push(error.message));
    // No build-data fixtures: /insights must load independently of monitoring.
    await page.route('**/api/chat/health', route => route.fulfill({ json: { ready: true, model: 'fixture-model' } }));
    await page.route('**/api/chat', async route => {
      const body = route.request().postDataJSON(); requests.push(body);
      if (failNext) { failNext = false; await route.fulfill({ status: 503, json: { error: 'Fixture backend unavailable' } }); return; }
      const text = body.messages.at(-1).content === 'Follow up' ? 'Follow-up answer using context.' : 'Fixture answer from cmssdt-ibs: **120 seconds**.';
      await route.fulfill({ contentType: 'application/x-ndjson', body: [
        { type: 'activity', text: 'Querying SearchIndexTool…' },
        { type: 'text', text }, { type: 'done' },
      ].map(event => JSON.stringify(event)).join('\n') + '\n' });
    });
    await page.goto('http://localhost:5174/#/insights');
    await page.getByRole('status').filter({ hasText: 'fixture-model' }).waitFor();
    const input = page.getByRole('textbox', { name: 'Ask about builds' });
    await input.fill('Build duration'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('120 seconds', { exact: true }).waitFor();
    await input.fill('Follow up'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Follow-up answer using context.').waitFor();
    assert.deepEqual(requests.at(-1).messages.map(message => message.role), ['user', 'assistant', 'user']);
    await page.reload();
    await page.getByText('Follow-up answer using context.').waitFor();
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByRole('heading', { name: 'Investigate your Integration Builds' }).waitFor();
    await input.fill('Independent question'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('120 seconds', { exact: true }).waitFor();
    assert.equal(requests.at(-1).messages.length, 1, 'new conversation does not send another conversation');
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
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cmssdt-chat-access')), 'browser-backend-token');
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
