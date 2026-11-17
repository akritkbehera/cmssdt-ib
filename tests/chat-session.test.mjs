import test from 'node:test';
import assert from 'node:assert/strict';
import { readSession, saveSession, clearSession } from '../src/Components/Insights/session.js';
import { conversationContext } from '../src/Components/Insights/transport.js';

test('remembered app sessions are scoped, expire, and can be revoked without storing CERN credentials', () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
  const handle = 'a'.repeat(43), endpoint = 'https://backend.test';
  saveSession(endpoint, handle, Date.now() + 60000, storage);
  assert.equal(readSession(endpoint, storage), handle);
  assert.equal(readSession('https://other.test', storage), '');
  assert.equal(readSession(endpoint, storage, Date.now() + 61000), '');
  saveSession(endpoint, handle, Date.now() + 60000, storage);
  clearSession(endpoint, storage);
  assert.equal(readSession(endpoint, storage), '');
});

test('empty failed assistant replies and old oversized history do not reject a short follow-up', () => {
  const message = (role, text) => ({ role, content: [{ type: 'text', text }] });
  const messages = [message('user', 'old'), message('assistant', 'x'.repeat(150000)), message('assistant', ''),
    message('user', 'What about CMSSW_20_1_X_2026-11-16-2300?')];
  assert.deepEqual(conversationContext(messages), [{ role: 'user', content: 'What about CMSSW_20_1_X_2026-11-16-2300?' }]);
  assert.equal(messages.length, 4, 'stored transcript is not mutated');
  assert.throws(() => conversationContext([message('user', 'x'.repeat(140001))]), /too large/);
  const recent = conversationContext(Array.from({ length: 200 }, (_, i) => message(i % 2 ? 'user' : 'assistant', 'turn ' + i)));
  assert.ok(recent.length <= 96);
  assert.equal(recent.at(-1).content, 'turn 199');
});
