const prefix = 'cmssdt-chat-login:';
export const sessionKey = endpoint => prefix + (endpoint || 'same-origin');
export function readSession(endpoint, storage, now = Date.now()) {
  try {
    storage ||= globalThis.localStorage;
    const item = JSON.parse(storage.getItem(sessionKey(endpoint)) || 'null');
    if (!item || !/^[A-Za-z0-9_-]{32,256}$/.test(item.handle) || !Number.isFinite(item.expiresAt) || item.expiresAt <= now || item.expiresAt > now + 8 * 3600000) {
      storage.removeItem(sessionKey(endpoint)); return '';
    }
    return item.handle;
  } catch { return ''; }
}
export function saveSession(endpoint, handle, expiresAt = Date.now() + 8 * 3600000, storage) {
  try { storage ||= globalThis.localStorage; storage.setItem(sessionKey(endpoint), JSON.stringify({ handle, expiresAt: Math.min(expiresAt, Date.now() + 8 * 3600000) })); } catch { /* Private browsing may allow memory sessions only. */ }
}
export function clearSession(endpoint, storage) {
  try { storage ||= globalThis.localStorage; storage.removeItem(sessionKey(endpoint)); } catch { /* Storage may be unavailable. */ }
}
