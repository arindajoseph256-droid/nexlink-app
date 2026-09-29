import { request } from './client';

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

export function getStarredMessages() {
  return request('/api/messages/starred/');
}
