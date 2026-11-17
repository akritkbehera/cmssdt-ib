import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AssistantRuntimeProvider, useLocalRuntime, ThreadPrimitive, MessagePrimitive,
  ComposerPrimitive, ErrorPrimitive } from '@assistant-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FaPlus, FaCog, FaArrowLeft, FaRegCommentDots, FaPaperPlane, FaStop, FaPen, FaTrash } from 'react-icons/fa';
import { createThread, deleteThread, renameThread, listThreads, historyAdapter } from './storage';
import { backendURL, chatAdapter } from './transport';
import useChatConnection from './useChatConnection';
import './insights.css';

const safeGet = (store, key) => { try { return window[store].getItem(key) || ''; } catch { return ''; } };
const safeSet = (store, key, value) => { try { window[store].setItem(key, value); } catch { /* Storage unavailable: selection stays in memory. */ } };
// The active conversation is remembered per browser tab (sessionStorage):
// reloading the page continues the tab's own investigation, while a fresh
// visit starts a new conversation instead of resuming an old one and
// re-sending its history on a greeting.
const ACTIVE_KEY = 'cmssdt-insights-active';
function Markdown({ text }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ({ node, ...props }) => <div className="insights-table-scroll" role="region" aria-label="Result table — scroll horizontally" tabIndex={0}><table {...props} /></div>, a: props => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{text}</ReactMarkdown>;
}
function Message() {
  return <MessagePrimitive.Root className="insights-message">
    <MessagePrimitive.If user><span className="insights-speaker">You</span></MessagePrimitive.If>
    <MessagePrimitive.If assistant><span className="insights-speaker">IB Insights</span></MessagePrimitive.If>
    <MessagePrimitive.Parts components={{ Text: Markdown }} />
    <MessagePrimitive.Error><ErrorPrimitive.Root className="insights-error" role="alert"><ErrorPrimitive.Message /></ErrorPrimitive.Root></MessagePrimitive.Error>
  </MessagePrimitive.Root>;
}
function Conversation({ thread, endpoint, token, onSaved, onError, onAuthenticationError }) {
  const [activity, setActivity] = useState('');
  const adapter = useMemo(() => chatAdapter({ endpoint, token, onActivity: setActivity, onError: onAuthenticationError }), [endpoint, token, onAuthenticationError]);
  const history = useMemo(() => historyAdapter(thread.id, onSaved, onError), [thread.id, onSaved, onError]);
  const runtime = useLocalRuntime(adapter, { adapters: { history } });
  useEffect(() => () => runtime.thread.cancelRun(), [runtime]);
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root className="insights-thread">
      <ThreadPrimitive.Viewport className="insights-transcript" aria-label="Conversation messages">
        <ThreadPrimitive.Empty><div className="insights-welcome">
          <FaRegCommentDots aria-hidden="true" /><h2>Investigate your Integration Builds</h2>
          <p>Ask about failures, flavours, architectures or build durations. Answers use the connected OpenSearch tools.</p>
          {['Across which flavours is this unit test failing?', 'Compare the latest completed full DEFAULT build with CLANG.', 'Find the recent history of a RelVal workflow.'].map(prompt =>
            <ThreadPrimitive.Suggestion key={prompt} prompt={prompt} send={false}>{prompt}</ThreadPrimitive.Suggestion>)}
        </div></ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage: Message, AssistantMessage: Message }} />
      </ThreadPrimitive.Viewport>
      <div className="insights-compose-area">
        <div className="insights-activity" role="status">{activity}</div>
        <ComposerPrimitive.Root className="insights-composer">
          <ComposerPrimitive.Input aria-label="Ask about builds" placeholder="Ask about builds, tests or resource usage…" rows={2} />
          <ThreadPrimitive.If running={false}><ComposerPrimitive.Send aria-label="Send message"><FaPaperPlane /></ComposerPrimitive.Send></ThreadPrimitive.If>
          <ThreadPrimitive.If running><ComposerPrimitive.Cancel aria-label="Stop response"><FaStop /></ComposerPrimitive.Cancel></ThreadPrimitive.If>
        </ComposerPrimitive.Root>
        <small>Chats are saved in this browser. Questions and conversation context are sent to the configured backend and CERN model. Verify conclusions against their sources.</small>
      </div>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}

export default function InsightsPage() {
  const [threads, setThreads] = useState([]), [selected, setSelected] = useState(null);
  const [error, setError] = useState(''), [settings, setSettings] = useState(false);
  const [endpoint, setEndpoint] = useState(() => backendURL(safeGet('localStorage', 'cmssdt-chat-backend') || import.meta.env.VITE_CHAT_BACKEND_URL || ''));
  const [token, setToken] = useState('');
  const [draftURL, setDraftURL] = useState(endpoint), [draftToken, setDraftToken] = useState(token);
  const connection = useChatConnection(endpoint, token, setError);
  useEffect(() => { try { sessionStorage.removeItem('cmssdt-chat-access'); } catch { /* Tokens now remain in memory. */ } }, []);
  const refresh = useCallback(async () => { try { setThreads(await listThreads()); } catch { setError('Browser storage is unavailable. Enable site storage to save and open conversations.'); } }, []);
  const selectThread = useCallback(thread => { safeSet('sessionStorage', ACTIVE_KEY, thread.id); setSelected(thread); }, []);
  useEffect(() => { let live = true; (async () => {
    try {
      const existing = await listThreads();
      if (!live) return;
      const remembered = safeGet('sessionStorage', ACTIVE_KEY);
      const thread = existing.find(entry => entry.id === remembered) || await createThread();
      if (live) { setThreads(await listThreads()); selectThread(thread); }
    } catch { if (live) setError('Browser storage is unavailable. Enable site storage to use conversations.'); }
  })(); return () => { live = false; }; }, [selectThread]);
  const act = async fn => { try { setError(''); await fn(); await refresh(); } catch { setError('Could not save this change in browser storage.'); } };
  return <div className="insights-page">
    <header className="insights-header"><Link to="/" aria-label="Back to builds"><FaArrowLeft /> Builds</Link>
      <h1>IB Insights</h1><button onClick={() => setSettings(value => !value)} aria-expanded={settings}><FaCog /> Connection</button></header>
    {settings && <form className="insights-settings" onSubmit={event => {
      event.preventDefault(); try {
        const url = backendURL(draftURL);
        localStorage.setItem('cmssdt-chat-backend', url);
        setEndpoint(url); setToken(draftToken); setError(''); setSettings(false);
      } catch (err) { setError(err.message); }
    }}>
      <label>Backend address<input type="url" placeholder="https://your-backend.example" value={draftURL} onChange={event => setDraftURL(event.target.value)} /></label>
      {connection.mode !== 'oidc' && <label>Backend access token<input type="password" autoComplete="off" value={draftToken} onChange={event => setDraftToken(event.target.value)} /></label>}
      <p>Leave the address empty for a same-origin backend. Authentication stays in memory and is cleared on reload. CERN AI and OpenSearch credentials belong on the backend.</p>
      <button type="submit">Save connection</button>
    </form>}
    {error && <div className="insights-error" role="alert">{error}</div>}
    <div className="insights-layout">
      <aside className="insights-sidebar" aria-label="Saved conversations">
        <button className="insights-new" onClick={() => act(async () => selectThread(await createThread()))}><FaPlus /> New conversation</button>
        <ul>{threads.map(thread => <li key={thread.id} className={selected?.id === thread.id ? 'is-selected' : ''}>
          <button className="insights-thread-select" title={thread.title} aria-current={selected?.id === thread.id ? 'true' : undefined} onClick={() => selectThread(thread)}>{thread.title}</button>
          <button aria-label={`Rename ${thread.title}`} onClick={() => { const name = window.prompt('Conversation name', thread.title); if (name?.trim()) act(() => renameThread(thread.id, name)); }}><FaPen /></button>
          <button aria-label={`Delete ${thread.title}`} onClick={() => { if (window.confirm(`Delete “${thread.title}” from this browser?`)) act(async () => {
            await deleteThread(thread.id);
            if (selected?.id === thread.id) selectThread((await listThreads())[0] || await createThread());
          }); }}><FaTrash /></button>
        </li>)}</ul>
      </aside>
      <main className="insights-main"><div className="insights-connection-bar">
        <p className="insights-connection" role="status">{connection.status}</p>
        <div className="insights-connection-actions">
          {connection.mode === 'oidc' && (connection.signedIn
            ? <button onClick={connection.logout}>Sign out</button>
            : <button onClick={connection.login} disabled={connection.signingIn}>{connection.signingIn ? 'Signing in…' : 'Sign in with CERN'}</button>)}
          <button onClick={() => connection.testConnection()} disabled={connection.checking || (connection.mode === 'oidc' && !connection.signedIn)}>{connection.checking ? 'Checking MCP…' : 'Test MCP connection'}</button>
        </div></div>
        {selected && <Conversation key={`${selected.id}:${endpoint}:${connection.token}`} thread={selected} endpoint={endpoint} token={connection.token} onSaved={refresh} onError={setError} onAuthenticationError={connection.expired} />}
      </main>
    </div>
  </div>;
}
