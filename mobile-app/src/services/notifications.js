/**
 * Push notification service (Expo push on Android).
 *
 * - Creates the Android notification channel
 * - Requests POST_NOTIFICATIONS permission (Android 13+)
 * - Registers the Expo push token with the Nexlink backend for this user
 * - Foreground presentation + tap handling (opens the right conversation)
 *
 * Note: FCM sender setup (google-services.json) is only needed for a
 * production APK; Expo Go / development builds use the Expo push token.
 */
import { Platform } from 'react-native';

let Notifications = null;
try {
  Notifications = require('expo-notifications');
} catch {}

const CHANNEL_ID = 'nexlink-messages';

export function notificationsAvailable() {
  return Boolean(Notifications);
}

export function setNotificationHandler() {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function ensureAndroidChannel() {
  if (!Notifications || Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#74ffd6',
    });
  } catch {}
}

export async function registerForPush(apiRegister) {
  if (!Notifications) return null;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return null;

    await ensureAndroidChannel();

    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse.data;
    if (token && apiRegister) await apiRegister(token);
    return token;
  } catch {
    return null;
  }
}

export function addNotificationTapListener(handler) {
  if (!Notifications) return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const conversationId = response?.notification?.request?.content?.data?.conversation_id;
    if (conversationId) handler(String(conversationId));
  });
  return () => subscription.remove();
}

export { Notifications };
