import { Platform } from 'react-native';

const configuredApiUrl = (process.env.EXPO_PUBLIC_API_URL || '').trim();
export const API_BASE_URL = configuredApiUrl
  || 'http://192.168.1.166:8000';
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

let authToken = null;

export function setAuthToken(token) {
  authToken = token;
}

export function getAuthToken() {
  return authToken;
}

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
    if (error.name === 'AbortError') {
      throw new Error(`The server did not respond. Check that Django is running at ${API_BASE_URL}.`);
    }
    throw new Error(`Cannot reach Django at ${API_BASE_URL}. Connect the phone to the same Wi-Fi network and start the backend.`);
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = data?.detail || Object.entries(data || {})
      .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(' ') : messages}`)
      .join(' ') || `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}

export function login(identifier, password) {
  const normalizedIdentifier = (identifier || '').trim();
  return request('/api/auth/login/', {
    method: 'POST',
    body: JSON.stringify(normalizedIdentifier.includes('@')
      ? { email: normalizedIdentifier.toLowerCase(), password }
      : { phone_number: normalizedIdentifier, password }),
  });
}

export function register(payload) {
  return request('/api/auth/register/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function logout() {
  return request('/api/auth/logout/', { method: 'POST' });
}

export function getConversations() {
  return request('/api/conversations/');
}

export function getMessages(conversationId) {
  return request(`/api/conversations/${conversationId}/messages/`);
}

export function sendMessage(conversationId, body) {
  return request(`/api/conversations/${conversationId}/messages/`, {
    method: 'POST',
    body: JSON.stringify({ body, message_type: 'text' }),
  });
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

export function getChatPeople() {
  return request('/api/chats/people/');
}

export function createGroup(name, userIds) {
  return request('/api/groups/', {
    method: 'POST',
    body: JSON.stringify({ name, user_ids: userIds }),
  });
}

export function markRead(conversationId) {
  return request(`/api/conversations/${conversationId}/read/`, { method: 'POST' });
}
