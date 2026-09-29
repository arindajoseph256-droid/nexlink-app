import { request } from './client';

export function getNotifications() {
  return request('/api/notifications/');
}

export function markNotificationsRead(notificationId = null) {
  return request('/api/notifications/read/', {
    method: 'POST',
    body: JSON.stringify(notificationId ? { id: notificationId } : {}),
  });
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
