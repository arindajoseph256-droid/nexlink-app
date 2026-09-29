import { request } from './client';

export function searchUsers(query) {
  return request(`/api/users/search/?q=${encodeURIComponent(query)}`);
}

export function getContacts() {
  return request('/api/contacts/');
}

export function toggleBlockUser(userId, blocked) {
  return request(`/api/users/${userId}/block/`, {
    method: blocked ? 'DELETE' : 'POST',
  });
}

export function reportUser(userId, reason) {
  return request(`/api/users/${userId}/report/`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
