/**
 * Central API configuration for the Nexlink Android client.
 *
 * Production builds must always talk to the real backend. A bad or missing
 * EXPO_PUBLIC_API_URL (localhost / 127.0.0.1 / 10.0.2.2 / LAN IPs) silently
 * breaks every request in a shipped APK, so unsafe values are rejected and
 * the known-good production URL is used instead. Development overrides are
 * still possible via EXPO_PUBLIC_ALLOW_INSECURE_API=1 (Expo Go / emulator).
 */

export const PRODUCTION_API_URL = 'https://nexlink-app.onrender.com';

const configured = (process.env.EXPO_PUBLIC_API_URL || '').trim();
const allowInsecure = process.env.EXPO_PUBLIC_ALLOW_INSECURE_API === '1';

const BLOCKED_IN_PRODUCTION = [
  /^https?:\/\/localhost(:\d+)?/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?/i,
  /^https?:\/\/0\.0\.0\.0(:\d+)?/i,
  /^https?:\/\/10\.0\.2\.2(:\d+)?/i,
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?/i,
  /^https?:\/\/\[::1\](:\d+)?/i,
];

const looksUnsafe = BLOCKED_IN_PRODUCTION.some((pattern) => pattern.test(configured));
const guardTriggered = Boolean(configured) && looksUnsafe && !allowInsecure;

if (guardTriggered) {
  console.warn(
    `[nexlink] EXPO_PUBLIC_API_URL="${configured}" is unsafe for this build. ` +
      `Falling back to ${PRODUCTION_API_URL}. Set EXPO_PUBLIC_ALLOW_INSECURE_API=1 ` +
      'for local development.',
  );
}

export const usingConfiguredUrl = Boolean(configured) && !guardTriggered;

export const API_BASE_URL = usingConfiguredUrl ? configured : PRODUCTION_API_URL;

/** Always wss:// in production (https→wss, http→ws only for dev overrides). */
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

/**
 * Release identity shown in the UI (login + account footers) and sent to
 * /api/mobile/version/. Keep in sync with expo.version / expo.android.versionCode
 * in app.json — the footers are how you can *prove* a fresh APK is installed.
 */
export const APP_VERSION = '1.3.0';
export const APP_BUILD = 4;
export const APP_VERSION_LABEL = `Nexlink ${APP_VERSION} (build ${APP_BUILD})`;

export const configDiagnostics = {
  configuredUrl: configured || null,
  resolvedUrl: API_BASE_URL,
  usedFallback: !usingConfiguredUrl,
  guardTriggered,
  allowInsecure,
};
