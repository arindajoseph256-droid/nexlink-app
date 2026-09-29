/**
 * Update service — two mechanisms:
 *
 * 1. OTA (JS/assets) via expo-updates / EAS Update.
 *    Checked on startup and on foreground resume, never in a loop.
 *
 * 2. Binary updates via the server-side /api/mobile/version/ endpoint.
 *    When a newer version (or a below-minimum version) is detected the app
 *    directs the user to the official download URL — it never sideloads
 *    APKs by itself.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { checkAppVersion } from '../api/version';
import { getDismissedVersion, rememberDismissedVersion } from '../storage/updateStorage';

let Updates = null;
try {
  Updates = require('expo-updates');
} catch {}

export const installedVersion = Constants.expoConfig?.version || '0.0.0';

export function otaAvailable() {
  return Boolean(Updates && Updates.isEnabled);
}

/** Returns { isAvailable, didRollBack } or null when OTA is unavailable. */
export async function checkOtaUpdate() {
  if (!otaAvailable()) return null;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return { isAvailable: false };
    const fetched = await Updates.fetchUpdateAsync();
    return { isAvailable: fetched.isNew, didRollBack: false };
  } catch {
    return null;
  }
}

export async function applyOtaUpdate() {
  if (!otaAvailable()) return;
  try {
    await Updates.reloadAsync();
  } catch {}
}

/**
 * Ask the backend whether a newer binary exists.
 * Respects a dismissed "Later" for the non-required prompt.
 */
export async function checkBinaryUpdate() {
  try {
    const data = await checkAppVersion(installedVersion);
    const dismissed = await getDismissedVersion();
    return {
      ...data,
      dismissed: !data.update_required && data.latest_version === dismissed,
    };
  } catch {
    return null; // offline / backend unreachable — never block the app
  }
}

export async function postponeBinaryUpdate(version) {
  await rememberDismissedVersion(version);
}

export function isAndroid() {
  return Platform.OS === 'android';
}
