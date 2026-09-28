# NEXLINK 1.1.0 — Release Notes

Version 1.1.0 ships the unified Nexlink platform: one Django backend serving
the web app, an installable PWA, and the Expo Android client (`com.nexlink.mobile`).

---

# NEXLINK 1.1.0 — Final Report

Deployed live to https://nexlink-app.onrender.com (commit `2178b4e`). Per the
build-order rule, the existing mobile-app was kept: it was a **real Expo/React
Native client already wired to the backend** (token login, WebSocket via
`accounts/ws_auth.py`) — not unsuitable, so Flutter was not introduced.

## 1. Preserved
Django+DRF+Channels+Daphne architecture · phone-first auth · all models/migrations ·
every REST endpoint · WebSockets & consumers · Calls (WebRTC) · media gallery ·
groups · the teal/mint web dashboard · render.yaml · all 105 existing tests.

## 2. Improved (web)
- Connection banner: `Connecting… / Reconnecting… / You are offline / connected`
  (hidden when healthy) driven by socket + browser online events, with
  exponential backoff already in socket.js
- Message states now include **Queued (offline)** and Failed icons
- Attachment/versioning bump (`v=13`), avatars, icons reused everywhere

## 3. Added
- **PWA**: `static/manifest.json` (Nexlink branding, teal theme, maskable icon,
  standalone), `service-worker.js` served from **root scope** (controls pages;
  verified active in headless Chromium; offline reload works; never caches
  `/api/` or `/media/`), generated `icon-192/512/maskable` PNGs from the logo
- **Offline outbox**: messages composed offline are queued in localStorage,
  rendered with a clock icon, auto-sent on reconnect
- **Push notifications (real, not polling)**: `PushDevice` model +
  `/api/auth/push/register|unregister/` + Expo push dispatch fired on message
  create — only to **offline** recipients, respecting `notifications_enabled`,
  pruning `DeviceNotRegistered` tokens
- **`/health/`** unauthenticated endpoint (`{"status":"ok","db":true}`) — now
  Render's health check
- **Android client**: secure token storage (expo-secure-store) + auto-login,
  connection manager with backoff, message pagination (`?before=<id>` — the
  backend already had it), image/camera/document attachments, voice notes
  (record/play), typing + presence + unread badges, offline outbox, push
  registration + notification tap → conversation, profile editing, settings
  toggles, boot/splash screen, `com.nexlink.mobile`, minimal permissions
  (INTERNET/POST_NOTIFICATIONS/CAMERA/RECORD_AUDIO)
- **Windows scripts**: `scripts\setup_mobile.bat`, `run_mobile.bat`, `build_apk.bat`

## 4. Key files
`accounts/push_models.py`, `accounts/push.py`, `accounts/api_views.py`,
`messaging/views.py` (push hook), `config/health.py`, `config/urls.py`,
`static/manifest.json`, `static/service-worker.js`, `static/js/nexus.js`
(banner/outbox/PWA), `templates/messaging/dashboard.html`,
`mobile-app/{App.js,api.js,app.json,eas.json}`, `scripts/*.bat`, `README.md`,
`docs/ENVIRONMENT.md`, `render.yaml`.

## 5. Database
Migrations `0009_pushdevice` + `0010` (index rename). Additive only, applied
locally and on production. No data touched.

## 6. Environment variables
`EXPO_ACCESS_TOKEN` (optional, raises push rate limits) · `EXPO_PUSH_URL`
(tests) · `EXPO_PUBLIC_API_URL` (dev shell var for the app). All documented in
`docs/ENVIRONMENT.md` — all other existing variables unchanged.

## 7. Render
No infra changes: same Daphne/Channels/Redis/Postgres blueprint;
`healthCheckPath` now `/health/`. Prod verified: `/health/` 200, manifest 200,
`/service-worker.js` 200, dashboard serving `v=13` with manifest link + banner.

## 8–9. Android build & APK
```bat
scripts\build_apk.bat
```
Runs `npx eas-cli build --platform android --profile preview` (EAS cloud build —
no Android SDK needed on the PC; free expo.dev account). EAS prints the APK
download URL; `.aab`: `--profile production`.

## 10. Testing
**110/110 tests OK** (5 new: push register/unregister/authz/400/health) ·
`manage.py check` clean · migrations clean · `node --check` all JS ·
headless-browser PWA verification (SW active, offline reload, banner states) ·
upload/scroll regressions re-verified · prod smoke passed. WS token auth
verified at the socket level (101 with valid token; unauthorized denied).

## 11. Honest remaining items
- **APK**: run `scripts\build_apk.bat` on Windows (the cloud sandbox cannot
  build Android)
- **Web real-time in the sandbox preview only**: cookie-authenticated WS
  handshakes 403 behind the sandbox proxy; token auth works and production
  real-time is unaffected
- **Push in Expo Go vs release APK**: `getExpoPushTokenAsync` works in Expo Go;
  a standalone/store build with FCM needs `google-services.json` (next step)
- **Media durability**: production uploads still live on Render's ephemeral
  disk; object storage (S3-compatible) remains the fix
- Voice notes/attachments from the web composer send as files; mobile handles
  image/audio/file natively
