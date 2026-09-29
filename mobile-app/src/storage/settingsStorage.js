import AsyncStorage from '@react-native-async-storage/async-storage';

const ENTER_TO_SEND_KEY = 'nexlink.enterToSend';
const CACHED_USER_KEY = 'nexlink.cachedUser';

export async function loadEnterToSend() {
  try {
    const raw = await AsyncStorage.getItem(ENTER_TO_SEND_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export async function saveEnterToSend(value) {
  try {
    await AsyncStorage.setItem(ENTER_TO_SEND_KEY, value ? '1' : '0');
  } catch {}
}

export async function cacheUserSnapshot(user) {
  try {
    if (user) await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else await AsyncStorage.removeItem(CACHED_USER_KEY);
  } catch {}
}

export async function loadUserSnapshot() {
  try {
    const raw = await AsyncStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearCachedUser() {
  try {
    await AsyncStorage.removeItem(CACHED_USER_KEY);
  } catch {}
}
