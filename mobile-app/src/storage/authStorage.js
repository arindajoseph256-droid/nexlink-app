import * as SecureStore from 'expo-secure-store';

import { bindTokenStorage } from '../api/client';
import { clearCachedUser } from './settingsStorage';

const TOKEN_KEY = 'nexlink.auth.token';
const USER_KEY = 'nexlink.auth.user';

let memoryToken = null;

export async function loadAuthToken() {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = (await SecureStore.getItemAsync(TOKEN_KEY)) || null;
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export async function setAuthToken(token) {
  memoryToken = token || null;
  try {
    if (memoryToken) await SecureStore.setItemAsync(TOKEN_KEY, memoryToken);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {}
  if (!memoryToken) {
    // Logging out removes any locally cached identity data.
    await clearCachedUser();
  }
}

/** Cache the last-known user object so the app can render instantly on boot. */
export async function cacheUser(user) {
  try {
    if (user) await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  } catch {}
}

export async function loadCachedUser() {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAuthToken() {
  return memoryToken;
}

/* Bind into the API client (avoids an import cycle client↔storage). */
bindTokenStorage(getAuthToken, () => {
  setAuthToken(null).catch(() => {});
});
