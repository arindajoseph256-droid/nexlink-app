import { request } from './client';

export function createGroup(name, userIds) {
  return request('/api/groups/', {
    method: 'POST',
    body: JSON.stringify({ name, user_ids: userIds }),
  });
}

export function getGroupDetail(conversationId) {
  return request(`/api/groups/${conversationId}/`);
}

export function updateGroup(conversationId, patch) {
  return request(`/api/groups/${conversationId}/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function leaveGroup(conversationId) {
  return request(`/api/groups/${conversationId}/leave/`, { method: 'POST' });
}

export function addGroupMember(conversationId, userId) {
  return request(`/api/groups/${conversationId}/members/`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export function removeGroupMember(conversationId, userId) {
  return request(`/api/groups/${conversationId}/members/${userId}/`, { method: 'DELETE' });
}

export function promoteGroupAdmin(conversationId, userId) {
  return request(`/api/groups/${conversationId}/admins/${userId}/`, { method: 'POST' });
}

export function demoteGroupAdmin(conversationId, userId) {
  return request(`/api/groups/${conversationId}/admins/${userId}/`, { method: 'DELETE' });
}

export function getChatPeople() {
  return request('/api/chats/people/');
}
