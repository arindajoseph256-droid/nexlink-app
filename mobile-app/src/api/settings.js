import { request } from './client';

/** GET synced preferences: theme, accent, status, enter_to_send, notifications,
 *  sounds, read_receipts, typing_indicator, last_seen_visible. */
export function getPreferences() {
  return request('/api/auth/preferences/');
}

/** PATCH the same keys the web settings screen saves. */
export function updatePreferences(patch) {
  return request('/api/auth/preferences/', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
