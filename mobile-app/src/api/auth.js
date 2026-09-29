import { request } from './client';

export async function login(identifier, password) {
  const normalized = (identifier || '').trim();
  const data = await request('/api/auth/login/', {
    method: 'POST',
    body: JSON.stringify(
      normalized.includes('@')
        ? { email: normalized.toLowerCase(), password }
        : { phone_number: normalized, password },
    ),
  });
  return data;
}

export function register(payload) {
  return request('/api/auth/register/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function logout() {
  try {
    await request('/api/auth/logout/', { method: 'POST' });
  } catch {}
}

export function getMe() {
  return request('/api/auth/me/full/');
}

export function updateProfile(patch) {
  return request('/api/auth/me/full/', { method: 'PATCH', body: JSON.stringify(patch) });
}

export function uploadAvatar(file) {
  const form = new FormData();
  form.append('avatar', {
    uri: file.uri,
    name: file.name || 'avatar.jpg',
    type: file.mimeType || 'image/jpeg',
  });
  return request('/api/auth/avatar/', { method: 'POST', body: form });
}

export function resetPasswordPageUrl() {
  // Handled via Linking in the auth screen; kept here for a single source of truth.
  return '/accounts/password-reset/';
}
