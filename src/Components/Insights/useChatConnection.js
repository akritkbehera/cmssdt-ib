import { readSession, saveSession, clearSession, sessionKey } from './session';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function useChatConnection(endpoint, serviceToken, onError) {
  const [session, setSession] = useState(''), [mode, setMode] = useState('service');
  const [status, setStatus] = useState('Checking backend…'), [tools, setTools] = useState([]);
  const [checking, setChecking] = useState(false), [signingIn, setSigningIn] = useState(false);
  const popup = useRef(null), attempt = useRef(null), probe = useRef(null);
  const token = session || serviceToken;
  const expired = useCallback(issue => {
    if (issue?.code === 'authentication_required' && issue.source !== 'model' && issue.source !== 'kerberos') {
      clearSession(endpoint); setSession(''); setTools([]); setStatus('Session expired · sign in with CERN again');
    }
  }, [endpoint]);
  useEffect(() => {
    setSession(readSession(endpoint)); setTools([]);
    const synchronize = event => {
      if (event.key === sessionKey(endpoint) || event.key === null) {
        const remembered = readSession(endpoint);
        setSession(remembered); setTools([]);
        if (!remembered) setStatus('Signed out of IB Insights');
      }
    };
    window.addEventListener('storage', synchronize);
    return () => { window.removeEventListener('storage', synchronize); attempt.current = null; popup.current?.close(); probe.current?.abort(); };
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('Checking backend…');
    const timeout = setTimeout(() => {
      setStatus('Backend health check timed out. Open its HTTPS health page to check connectivity and certificate trust.');
      controller.abort();
    }, 12000);
    fetch(`${endpoint}/api/chat/health`, { signal: controller.signal,
      headers: serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {} })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })
      .then(value => {
        setMode(value.authMode || 'service');
        setStatus(value.ready ? `Backend configured · ${value.model} · MCP not tested`
          : 'Backend needs CERN model configuration · MCP not tested');
      }).catch(error => { if (!controller.signal.aborted) setStatus(error.message && error.message !== 'Failed to fetch' && !error.message.includes('JSON') ? error.message : 'Backend unavailable · open Connection'); }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [endpoint, serviceToken]);
  const testConnection = useCallback(async override => {
    probe.current?.abort();
    const controller = new AbortController(); probe.current = controller;
    const timeout = setTimeout(() => controller.abort(), 50000);
    setChecking(true); setStatus('Initializing MCP and listing tools…');
    try {
      const credential = override || token;
      const response = await fetch(`${endpoint}/api/chat/connection`, { method: 'POST', signal: controller.signal,
        headers: credential ? { Authorization: `Bearer ${credential}` } : {} });
      const result = await response.json();
      if (!response.ok) { expired(result); throw new Error(result.error || 'MCP connection failed.'); }
      if (result.connected !== true || !Array.isArray(result.tools)) throw new Error('Backend did not verify MCP tools/list.');
      setTools(result.tools); setStatus(`MCP tools/list verified · ${result.tools.join(', ')}`); onError('');
    } catch (error) {
      setTools([]);
      const text = error.name === 'AbortError' ? 'Connection check timed out or was cancelled.'
        : error.message === 'Failed to fetch' ? 'Cannot reach the backend. Check its HTTPS address, network and allowed frontend origin.' : error.message;
      setStatus(text); onError(text);
    } finally { clearTimeout(timeout); if (probe.current === controller) setChecking(false); }
  }, [endpoint, token, expired, onError]);
  useEffect(() => {
    const receive = event => {
      const active = attempt.current;
      if (!active || event.source !== popup.current || event.origin !== new URL(endpoint || location.origin).origin ||
        event.data?.type !== 'cmssdt-cern-login' || event.data.loginId !== active.id) return;
      attempt.current = null; setSigningIn(false); popup.current?.close();
      if (event.data.error) { onError(event.data.error); setStatus('CERN sign-in failed'); return; }
      if (typeof event.data.session !== 'string' || event.data.session.length < 32) return;
      saveSession(endpoint, event.data.session, event.data.expiresAt);
      setSession(event.data.session); void testConnection(event.data.session);
    };
    window.addEventListener('message', receive);
    const timer = setInterval(() => {
      if (attempt.current && (popup.current?.closed || Date.now() > attempt.current.expires)) {
        attempt.current = null; setSigningIn(false); setStatus('CERN sign-in cancelled or expired'); popup.current?.close();
      }
    }, 1000);
    return () => { window.removeEventListener('message', receive); clearInterval(timer); };
  }, [endpoint, onError, testConnection]);
  useEffect(() => {
    if (!session || mode !== 'oidc') return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    fetch(`${endpoint}/api/chat/auth/session`, { signal: controller.signal, headers: { Authorization: `Bearer ${session}` } })
      .then(async response => {
        if (response.status === 401) {
          clearSession(endpoint); setSession(''); setTools([]); setStatus('Session expired · sign in with CERN again');
        } else if (!response.ok) throw new Error('Session check failed');
      }).catch(() => { /* Keep a remembered session on transient network failures; every API request validates it. */ })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [endpoint, session, mode]);
  function login() {
    const id = crypto.randomUUID(), url = new URL(`${endpoint}/api/chat/auth/start`, location.origin);
    url.searchParams.set('origin', location.origin); url.searchParams.set('login_id', id);
    attempt.current = { id, expires: Date.now() + 300000 };
    popup.current = window.open(url.href, 'cmssdt-cern-login', 'popup,width=600,height=760');
    if (!popup.current) { attempt.current = null; onError('Allow the CERN sign-in popup and try again.'); return; }
    setSigningIn(true); setStatus('Complete CERN sign-in in the popup');
  }
  async function logout() {
    try { await fetch(`${endpoint}/api/chat/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session}` } }); }
    finally { clearSession(endpoint); setSession(''); setTools([]); setStatus('Signed out of IB Insights'); }
  }
  return { token, mode, status, tools, checking, signingIn, signedIn: Boolean(session), login, logout, testConnection, expired };
}
