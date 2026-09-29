import { request } from './client';

export function getConversations() {
  return request('/api/conversations/');
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

export function markRead(conversationId) {
  return request(`/api/conversations/${conversationId}/read/`, { method: 'POST' });
}

export function setConversationState(conversationId, patch) {
  return request(`/api/conversations/${conversationId}/state/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function clearChat(conversationId) {
  return request(`/api/conversations/${conversationId}/clear/`, { method: 'POST' });
}

export function getConversationMedia(conversationId) {
  return request(`/api/conversations/${conversationId}/media/`);
}
