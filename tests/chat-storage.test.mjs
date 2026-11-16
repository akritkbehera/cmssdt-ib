import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThread, historyAdapter, renameThread, listThreads, deleteThread } from '../src/Components/Insights/storage.js';

test('browser conversations persist separately, rename, update and cannot be resurrected after deletion', async () => {
  const a = await createThread(), b = await createThread();
  const saved = historyAdapter(a.id, () => {});
  const item = { parentId: null, message: { id: 'u1', role: 'user', createdAt: new Date(), content: [{ type: 'text', text: 'Which builds fail?' }] } };
  await saved.append(item);
  assert.equal((await historyAdapter(a.id, () => {}).load()).messages.length, 1);
  assert.equal((await historyAdapter(b.id, () => {}).load()).messages.length, 0);
  await renameThread(a.id, 'Failure investigation');
  await saved.update({ ...item, message: { ...item.message, content: [{ type: 'text', text: 'Updated question' }] } });
  assert.equal((await listThreads()).find(thread => thread.id === a.id).title, 'Failure investigation');
  assert.equal((await saved.load()).messages.length, 1);
  await deleteThread(a.id);
  await saved.append(item);
  assert.ok(!(await listThreads()).some(thread => thread.id === a.id));
});
