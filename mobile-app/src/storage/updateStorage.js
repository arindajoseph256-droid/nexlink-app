import AsyncStorage from '@react-native-async-storage/async-storage';

const DISMISSED_KEY = 'nexlink.update.dismissedVersion';

export async function rememberDismissedVersion(version) {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, String(version || ''));
  } catch {}
}

export async function getDismissedVersion() {
  try {
    return (await AsyncStorage.getItem(DISMISSED_KEY)) || '';
  } catch {
    return '';
  }
}
