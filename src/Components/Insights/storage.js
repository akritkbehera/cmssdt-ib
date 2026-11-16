import { openDB } from 'idb';

let database;
export function chatDatabase() {
  return database ||= openDB('cmssdt-insights', 1, {
    upgrade(db) { db.createObjectStore('threads', { keyPath: 'id' }); },
  });
}
export async function listThreads() {
  return (await (await chatDatabase()).getAll('threads')).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function createThread() {
  const thread = { id: crypto.randomUUID(), title: 'New conversation', updatedAt: Date.now(), repository: { messages: [] } };
  await (await chatDatabase()).put('threads', thread);
  return thread;
}
export async function deleteThread(id) { await (await chatDatabase()).delete('threads', id); }
export async function renameThread(id, title) {
  const db = await chatDatabase(), tx = db.transaction('threads', 'readwrite');
  const thread = await tx.store.get(id);
  if (thread) { thread.title = title.trim().slice(0, 100) || 'Conversation'; thread.renamed = true; await tx.store.put(thread); }
  await tx.done;
}
export function historyAdapter(id, onSaved, onError = () => {}) {
  const write = async item => {
    const db = await chatDatabase(), tx = db.transaction('threads', 'readwrite');
    const thread = await tx.store.get(id);
    // A late completion must not resurrect a deleted conversation.
    if (!thread) { await tx.done; return; }
    const items = thread.repository.messages;
    const position = items.findIndex(entry => entry.message.id === item.message.id);
    if (position < 0) items.push(item); else items[position] = item;
    thread.repository.headId = item.message.id;
    thread.updatedAt = Date.now();
    if (!thread.renamed && item.message.role === 'user' && thread.title === 'New conversation') {
      thread.title = item.message.content.filter(part => part.type === 'text').map(part => part.text).join(' ').slice(0, 70);
    }
    await tx.store.put(thread); await tx.done; onSaved();
  };
  const store = async item => {
    try { await write(item); } catch (error) { onError('Could not save this conversation. Browser storage may be full.'); throw error; }
  };
  return {
    scopeId: id,
    async load() {
      try { return (await (await chatDatabase()).get('threads', id))?.repository || { messages: [] }; }
      catch (error) { onError('Could not load this conversation from browser storage.'); throw error; }
    },
    append: store, update: store,
  };
}
