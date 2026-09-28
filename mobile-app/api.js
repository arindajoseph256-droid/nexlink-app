import { Platform } from 'react-native';

const configuredApiUrl = (process.env.EXPO_PUBLIC_API_URL || '').trim();
export const API_BASE_URL = configuredApiUrl
  || 'https://nexlink-app.onrender.com';
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

/* ------------------------------------------------------------------ */
/* Secure token persistence. Uses expo-secure-store (Android Keystore) */
/* when installed; degrades gracefully to memory-only so the app never */
/* crashes and never writes tokens to plain-text storage.              */
/* ------------------------------------------------------------------ */
let authToken = null;
let secureStore = null;
try {
  // Optional dependency: installed for release builds via package.json.
  secureStore = require('expo-secure-store');
} catch {
  secureStore = null;
}

const TOKEN_KEY = 'nexlink.auth.token';

export async function loadAuthToken() {
  if (authToken) return authToken;
  if (secureStore) {
    try {
      authToken = (await secureStore.getItemAsync(TOKEN_KEY)) || null;
    } catch {
      authToken = null;
    }
  }
  return authToken;
}

export async function setAuthToken(token) {
  authToken = token || null;
  if (secureStore) {
    try {
      if (authToken) await secureStore.setItemAsync(TOKEN_KEY, authToken);
      else await secureStore.deleteItemAsync(TOKEN_KEY);
    } catch {}
  }
}

export function getAuthToken() {
  return authToken;
}

/* ------------------------------------------------------------------ */
/* Connection state — single source of truth for UI banners.          */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* HTTP layer                                                         */
/* ------------------------------------------------------------------ */
async function request(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(authToken ? { Authorization: `Token ${authToken}` } : {}),
    ...(options.headers || {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    connectionState.set({ online: false });
    if (error.name === 'AbortError') {
      throw new Error(`The server did not respond. Check that Django is running at ${API_BASE_URL}.`);
    }
    throw new Error(`Cannot reach Nexlink at ${API_BASE_URL}. Check your internet connection.`);
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
    if (response.status === 401) connectionState.set({ authExpired: true });
    const detail = data?.detail || Object.entries(data || {})
      .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(' ') : messages}`)
      .join(' ') || `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */
export async function login(identifier, password) {
  const normalizedIdentifier = (identifier || '').trim();
  const data = await request('/api/auth/login/', {
    method: 'POST',
    body: JSON.stringify(normalizedIdentifier.includes('@')
      ? { email: normalizedIdentifier.toLowerCase(), password }
      : { phone_number: normalizedIdentifier, password }),
  });
  await setAuthToken(data.token);
  return data;
}

export async function register(payload) {
  const data = await request('/api/auth/register/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await setAuthToken(data.token);
  return data;
}

export async function logout() {
  try { await request('/api/auth/logout/', { method: 'POST' }); } catch {}
  await setAuthToken(null);
}

/* ------------------------------------------------------------------ */
/* Conversations & messages                                           */
/* ------------------------------------------------------------------ */
export function getConversations() {
  return request('/api/conversations/');
}

export function getMessages(conversationId) {
  return request(`/api/conversations/${conversationId}/messages/`);
}

export function getOlderMessages(conversationId, oldestId) {
  return request(`/api/conversations/${conversationId}/messages/?before=${oldestId}`);
}

export function sendMessage(conversationId, body, replyTo = null) {
  return request(`/api/conversations/${conversationId}/messages/`, {
    method: 'POST',
    body: JSON.stringify(
      replyTo ? { body, message_type: 'text', reply_to: replyTo } : { body, message_type: 'text' },
    ),
  });
}

export function sendAttachment(conversationId, file, kind, text = ' ') {
  const form = new FormData();
  form.append('body', text);
  form.append('message_type', kind);
  form.append('attachment', {
    uri: file.uri,
    name: file.name || `upload-${Date.now()}`,
    type: file.mimeType || 'application/octet-stream',
  });
  return request(`/api/conversations/${conversationId}/messages/`, {
    method: 'POST',
    body: form,
  });
}

export function markRead(conversationId) {
  return request(`/api/conversations/${conversationId}/read/`, { method: 'POST' });
}

export function searchUsers(query) {
  return request(`/api/users/search/?q=${encodeURIComponent(query)}`);
}

export function startConversation(userId) {
  return request('/api/conversations/start/', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export function startConversationByPhone(phone) {
  return request('/api/chats/by-phone/', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

export function getChatPeople() {
  return request('/api/chats/people/');
}

export function createGroup(name, userIds) {
  return request('/api/groups/', {
    method: 'POST',
    body: JSON.stringify({ name, user_ids: userIds }),
  });
}

export function leaveGroup(conversationId) {
  return request(`/api/groups/${conversationId}/leave/`, { method: 'POST' });
}

/* ------------------------------------------------------------------ */
/* Message actions (parity with the web app)                           */
/* ------------------------------------------------------------------ */
export function toggleReaction(messageId, emoji) {
  return request(`/api/messages/${messageId}/react/`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export function editMessage(messageId, body) {
  return request(`/api/messages/${messageId}/edit/`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
}

export function deleteMessage(messageId) {
  return request(`/api/messages/${messageId}/delete/`, { method: 'POST' });
}

export function deleteMessageForMe(messageId) {
  return request(`/api/messages/${messageId}/delete-for-me/`, { method: 'POST' });
}

export function starMessage(messageId) {
  return request(`/api/messages/${messageId}/star/`, { method: 'POST' });
}

export function pinMessage(messageId) {
  return request(`/api/messages/${messageId}/pin/`, { method: 'POST' });
}

/* ------------------------------------------------------------------ */
/* Chat state: pin/mute/archive the conversation (per user) + clear    */
/* ------------------------------------------------------------------ */
export function setConversationState(conversationId, patch) {
  return request(`/api/conversations/${conversationId}/state/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function clearChat(conversationId) {
  return request(`/api/conversations/${conversationId}/clear/`, { method: 'POST' });
}

/* ------------------------------------------------------------------ */
/* Notifications (in-app bell) + blocking                              */
/* ------------------------------------------------------------------ */
export function getNotifications() {
  return request('/api/notifications/');
}

export function markNotificationsRead() {
  return request('/api/notifications/read/', { method: 'POST' });
}

export function toggleBlockUser(userId, blocked) {
  return request(`/api/users/${userId}/block/`, {
    method: blocked ? 'DELETE' : 'POST',
  });
}

/* ------------------------------------------------------------------ */
/* Profile & settings                                                 */
/* ------------------------------------------------------------------ */
export function getMe() {
  return request('/api/auth/me/full/');
}

export function updateProfile(patch) {
  return request('/api/auth/me/full/', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function getPreferences() {
  return request('/api/auth/preferences/');
}

export function updatePreferences(patch) {
  return request('/api/auth/preferences/', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/* ------------------------------------------------------------------ */
/* Push notifications (Expo). Registered after login, removed after   */
/* logout so this device stops receiving pushes.                      */
/* ------------------------------------------------------------------ */
export function registerPushToken(token) {
  return request('/api/auth/push/register/', {
    method: 'POST',
    body: JSON.stringify({ token, platform: 'expo' }),
  });
}

export function unregisterPushToken(token) {
  return request('/api/auth/push/unregister/', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}
