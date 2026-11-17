export function backendURL(value) {
  if (!value?.trim()) return '';
  const url = new URL(value);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('Use a backend HTTP(S) address without credentials, query or fragment.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Use HTTPS for a remote backend.');
  }
  return value.trim().replace(/\/+$/, '').replace(/\/api\/chat$/, '');
}

export async function* readEvents(response) {
  if (!response.ok) {
    let issue;
    try { issue = await response.json(); } catch { /* Static host may return HTML. */ }
    throw Object.assign(new Error(issue?.error || `Chat backend unavailable (${response.status}). Open Connection to configure it.`), { code: issue?.code, source: issue?.source });
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('The address is not a chat backend. Open Connection to configure it.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n'); pending = lines.pop();
      if (done && pending.trim()) { lines.push(pending); pending = ''; }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'error') throw Object.assign(new Error(event.text), { code: event.code, source: event.source });
        if (event.type === 'done') complete = true;
        yield event;
      }
      if (done) break;
    }
    if (!complete) throw new Error('Connection ended before the answer completed. Try again.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function conversationContext(messages) {
  const valid = messages.filter(message => ['user', 'assistant'].includes(message.role))
    .map(message => ({ role: message.role, content: message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') }))
    .filter(message => message.content.trim());
  const recent = []; let chars = 0;
  for (let i = valid.length - 1; i >= 0 && recent.length < 96; i--) {
    if (chars + valid[i].content.length > 140000) break;
    recent.unshift(valid[i]); chars += valid[i].content.length;
  }
  while (recent.length && recent[0].role !== 'user') recent.shift();
  while (recent.length && new TextEncoder().encode(JSON.stringify({ messages: recent })).length > 480000) {
    recent.shift();
    while (recent.length && recent[0].role !== 'user') recent.shift();
  }
  if (!recent.length || recent.at(-1).role !== 'user') throw new Error('Your latest question is too large. Shorten it before sending.');
  return recent;
}

export function chatAdapter({ endpoint, token, onActivity, onError = () => {} }) {
  return {
    async *run({ messages, abortSignal }) {
      onActivity('Connecting…');
      let text = '';
      try {
        const response = await fetch(`${endpoint}/api/chat`, {
          method: 'POST', signal: abortSignal,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ messages: conversationContext(messages) }),
        });
        for await (const event of readEvents(response)) {
          if (event.type === 'activity') onActivity(event.text);
          if (event.type === 'text') { text += event.text; onActivity('Writing answer…'); yield { content: [{ type: 'text', text }] }; }
        }
      } catch (error) { onError(error); throw error; }
      finally { onActivity(''); }
    },
  };
}
