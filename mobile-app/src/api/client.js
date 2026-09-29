/**
 * Central API client: single fetch wrapper for every request.
 *
 * - Token auth (Authorization: Token <key>) from the secure store
 * - 15s timeout via AbortController
 * - JSON parsing + human-readable error extraction
 * - 401 marks the session expired (App-level effect logs the user out)
 * - connectionState pub/sub drives offline banners and the outbox flush
 */
import { API_BASE_URL } from './config';

export const connectionState = {
  online: true,
  socket: false,
  listeners: new Set(),
  set(patch) {
    Object.assign(this, patch);
    this.listeners.forEach((fn) => fn({ online: this.online, socket: this.socket }));
  },
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

/* --- token plumbing (injected by storage/authStorage to avoid a cycle) --- */
let tokenGetter = () => null;
let tokenCleaner = null;

export function bindTokenStorage(getter, cleaner) {
  tokenGetter = getter || (() => null);
  tokenCleaner = cleaner || null;
}

export function getAuthToken() {
  return tokenGetter();
}

/* Auth-expiry pub/sub: any 401 notifies listeners (App clears the session). */
const authExpiredListeners = new Set();

export function onAuthExpired(fn) {
  authExpiredListeners.add(fn);
  return () => authExpiredListeners.delete(fn);
}

export function notifyAuthExpired() {
  authExpiredListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
  if (tokenCleaner) tokenCleaner();
}

export async function request(path, options = {}) {
  const token = tokenGetter();
  const headers = {
    Accept: 'application/json',
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Token ${token}` } : {}),
    ...(options.headers || {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
  } catch (error) {
    connectionState.set({ online: false });
    if (error.name === 'AbortError') {
      throw new Error('The server did not respond. Check your internet connection or try again later.');
    }
    throw new Error(`Unable to connect to Nexlink. Please check your internet connection or try again.`);
  } finally {
    clearTimeout(timeout);
  }
  connectionState.set({ online: true });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (response.status === 401) notifyAuthExpired();
    const detail =
      data?.detail ||
      Object.entries(data || {})
        .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(' ') : messages}`)
        .join(' ') ||
      `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}
