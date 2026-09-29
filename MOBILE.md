# NEXLINK Android app (`mobile-app/`)

A real Expo (React Native, SDK 57) counterpart of the Django web app — no WebView,
no mocks. It talks to the same backend as the website/PWA: same accounts, same
conversations, same WebSockets, same preferences.

## Architecture

```
mobile-app/
├── App.js                 boot sequence (see below)
├── index.js               RN entry, registers App
├── app.json / eas.json    build + EAS Update config
└── src/
    ├── api/               typed-ish REST wrappers over fetch
    │   ├── config.js        base URLs + production-API guard
    │   ├── client.js        Token auth, 15s timeouts, connection state, 401 hook
    │   ├── auth.js · conversations.js · messages.js · users.js · groups.js
    │   ├── settings.js · notifications.js · calls.js · version.js · index.js
    ├── storage/           persistent state
    │   ├── authStorage.js     token + cached user (expo-secure-store)
    │   ├── settingsStorage.js enter-to-send + user snapshot (AsyncStorage)
    │   └── updateStorage.js   dismissed binary-update version
    ├── services/
    │   ├── websocket.js       ManagedSocket: backoff reconnect (0.5s→15s), single
    │   │                      shared user socket, per-chat chat sockets
    │   ├── offlineQueue.js    outbox in SecureStore, client_id dedupe, auto-flush
    │   ├── syncService.js     foreground resume → reconnect + queue flush
    │   ├── notifications.js   expo-notifications: Android channel, push registration,
    │   │                      tap handling
    │   ├── media.js           image/camera/document picking
    │   └── updateService.js   OTA (expo-updates) + binary version checks
    ├── theme/             ThemeProvider: light/dark/system + accent color,
    │                      synced with the server preferences API both ways
    ├── components/        MessageBubble (+DaySeparator), MessageComposer,
    │                      ConversationItem, TypingIndicator, SearchBar,
    │                      ConnectionBanner, shared ui primitives
    ├── navigation/        Root → Auth stack | Main tabs/stack (Call = fullScreenModal)
    ├── screens/           Login, Register, Conversations, Chat, Profile, Settings,
    │                      Appearance/Notification/Privacy/Chat/Account settings,
    │                      Group create, Call
    └── utils/ · branding.js
```

### Boot sequence (`App.js`)

1. Load the auth token (SecureStore) and paint the cached user immediately.
2. Verify the token with `GET /api/auth/me/`; a failure clears it (401 → logged out).
3. Open the shared notifications socket `/ws/notifications/?token=<key>`.
4. Register for push notifications (Android channel `nexlink-messages`).
5. Check for an **OTA update** (EAS Update) — applied on next restart.
6. Check the **binary version** against `/api/mobile/version/` — a notice with the
   official download URL is shown when a newer APK exists (mandatory when the
   installed version is below `minimum_supported_version`).
7. Foreground resume → reconnect sockets, flush the offline queue, re-check OTA.

Every CTA in the auth flow preserves the requested destination
(`/auth?returnTo=...` equivalent: the app returns to the screen that triggered login).

## Backend URL & the production guard

The app reads `EXPO_PUBLIC_API_URL` and falls back to
`https://nexlink-app.onrender.com`. Because a bad value in a shipped APK breaks
every request silently, `src/api/config.js` **rejects unsafe URLs**
(localhost, 127.0.0.1, 0.0.0.0, 10.0.2.2, 192.168.*, `[::1]`) and falls back to
production with a console warning.

To point a dev build at your LAN machine:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 EXPO_PUBLIC_ALLOW_INSECURE_API=1 npx expo start
```

`EXPO_PUBLIC_ALLOW_INSECURE_API=1` disables the guard (Expo Go / emulator only —
never set it for release builds).

## Update flows

Two independent mechanisms cover JS and native changes:

| Change type | Mechanism | How it ships |
| ----------- | --------- | ------------ |
| JS / assets only (screens, styles, logic) | **EAS Update (OTA)** — `expo-updates` | `eas update` publishes; apps download at next launch (`checkAutomatically: on-load`, no launch wait) |
| Native code, new permissions, SDK bumps, `app.json` plugin changes | **New APK/AAB** | `eas build`, then bump the server config below |

**Important: OTA cannot update native code.** Anything touching a native module
(e.g. adding expo-camera, changing permissions) requires a new binary — that is
what the binary version check is for.

### Server-side version gate

`GET /api/mobile/version/?version=x.y.z` (public, no auth) returns:

```json
{
  "latest_version": "1.1.0",
  "minimum_supported_version": "1.0.0",
  "update_required": false,
  "download_url": "",
  "release_notes": "",
  "platform": "android",
  "installed_version": "x.y.z",
  "update_available": false
}
```

Configuration lives in the `MOBILE_VERSIONS` Django setting (see
`messaging/mobile_version.py`). To release a new APK:

1. Build with `eas build` and publish/host the APK file.
2. In the Django settings (env or settings module) set/override:

```python
MOBILE_VERSIONS = {
    "latest_version": "1.2.0",
    "minimum_supported_version": "1.1.0",   # below this → update_required = true
    "update_required": False,               # hard kill-switch for emergency blocks
    "download_url": "https://.../nexlink-1.2.0.apk",
    "release_notes": "Voice messages and group admin tools.",
}
```

3. Every installed app picks this up on next start — no client release needed.
   `update_available` drives the "new version" notice; `update_required` (or an
   installed version below `minimum_supported_version`) makes it non-dismissable.

## First-time EAS setup (one-time, requires an expo.dev account)

The repo ships with **placeholder** values (all-zero UUID) — they must be
replaced by your real project; they are intentionally not invented here:

```bash
cd mobile-app
npm install
npx eas login            # or: EXPO_TOKEN=... in CI
npx eas init             # creates the project, prints the project ID
# → put that ID in app.json:  extra.eas.projectId  AND  updates.url
npx eas update:configure # wires channels if you skipped manual config
```

`app.json` already contains:

```json
"updates": { "url": "https://u.expo.dev/<projectId>", "fallbackToCacheTimeout": 0, "checkAutomatically": "on-load" },
"runtimeVersion": { "policy": "appVersion" }
```

With the `appVersion` policy the runtime version equals the `version` string
(currently `1.1.0`): **bump `expo.version` for every binary release** so OTA
updates target the right binaries, and JS-only fixes can be published with
`eas update --channel production` without a store/build cycle.

Channels in `eas.json`: `preview` (APK builds) and `production` (AAB builds).

## Building

```bash
cd mobile-app
npx eas build --platform android --profile preview      # .apk (side-load)
npx eas build --platform android --profile production   # .aab (Play Store)
```

Local bundle sanity check (no EAS account needed):

```bash
npx expo export --platform android --output-dir dist-check   # rm -rf dist-check after
```

## Realtime & offline

- `/ws/notifications/` — one shared socket per user (conversations list,
  presence, call invitations, notifications).
- `/ws/chat/<id>/` — opened per open chat: `message.new/edited/deleted`,
  `typing.event`, `read.event`, `presence.event`, `reaction.updated`.
  Client sends `{type:'typing', is_typing}`, `{type:'read', message_id}`,
  `{type:'presence.ping'}`.
- Auth: `?token=<Token key>` query param (`accounts/ws_auth.py`).
- `ManagedSocket` reconnects with exponential backoff (0.5s doubling, 15s cap)
  and exposes a connection state used by the ConnectionBanner.
- Messages composed while offline are queued in SecureStore with a `client_id`
  (deduped on the server handshake) and flushed automatically when the chat
  socket or app returns to the foreground.

## Known limitations

- **Calls:** full lifecycle (ring/accept/decline/end + signaling) works, but the
  P2P audio/video media path needs a native WebRTC module that is not installed
  yet — CallScreen states this honestly instead of faking it.
- **Voice notes:** recording is intentionally not implemented (the audio-player
  hook exists via expo-audio); the composer shows an explanatory alert.
- **Push:** the backend sends via Expo push tokens registered with
  `/api/auth/push/register/`; registering requires a development build or a
  store build (not Expo Go) for reliable foreground banners on Android 13+.
