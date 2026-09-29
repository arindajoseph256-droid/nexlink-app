import { request } from './client';

export function getNotifications() {
  return request('/api/notifications/');
}

export function markNotificationsRead() {
  return request('/api/notifications/read/', { method: 'POST' });
}

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
