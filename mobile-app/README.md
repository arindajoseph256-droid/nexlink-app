# Nexlink Android (`mobile-app/`)

Official native Android client of the Nexlink platform — same Django backend, same
database, same accounts, same real-time system as
[https://nexlink-app.onrender.com](https://nexlink-app.onrender.com).
No WebView, no mocks.

- Feature status: see [FEATURE_PARITY.md](FEATURE_PARITY.md)
- Update system (OTA + APK gating): see [UPDATES.md](UPDATES.md)
- Architecture deep-dive: see [../MOBILE.md](../MOBILE.md)

## Requirements

- Node 18+ and npm
- An expo.dev account (free) for EAS builds/updates
- For device testing: the **Expo Go** app, or a development build installed on the phone

## Install

```bash
cd mobile-app
npm install
```

## Run in development

```bash
npx expo start
```

Scan the QR code with Expo Go (Android) or press `a` for an emulator. The app talks
to the production API by default; to use a local Django server instead:

```bash
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8000 EXPO_PUBLIC_ALLOW_INSECURE_API=1 npx expo start
```

`EXPO_PUBLIC_ALLOW_INSECURE_API=1` is required to point the app at localhost/LAN —
production builds refuse unsafe URLs and fall back to
`https://nexlink-app.onrender.com` (see `src/api/config.js`).

## Configure the project (one-time)

`app.json` ships with an intentional placeholder project ID. After creating your
expo.dev project:

```bash
npx eas login
npx eas init          # prints the project ID
```

Then replace **both** placeholders in `app.json`:

- `extra.eas.projectId` → the printed ID
- `updates.url` → `https://u.expo.dev/<the-printed-ID>`

Nothing else needs changing; `runtimeVersion`, channels and update behavior are
already configured (see [UPDATES.md](UPDATES.md)).

## Build Android

```bash
npx eas build --platform android --profile preview      # .apk (side-load / testing)
npx eas build --platform android --profile production   # .aab (Play Store)
```

Build status and download links: https://expo.dev → your project → Builds.
The APK URL is printed when the build finishes — host it at your official download
location and point `MOBILE_VERSIONS.download_url` (Django setting) at it so old
installs can find the update.

## Publish an OTA update (JS-only changes)

```bash
npx eas update --channel production -m "Describe the change"
```

Installed apps fetch it on next launch. Native changes require a new build instead —
the decision matrix is in [UPDATES.md](UPDATES.md).

## Project structure

```
src/
├── api/           REST client + endpoint modules (auth, chats, settings, calls, version…)
├── components/    bubbles, composer, modals, settings rows, connection banner…
├── navigation/    Root → Auth | Main stacks (Call = fullScreenModal)
├── screens/       Login, Register, Conversations, Chat, Profile, Settings hub,
│                  Account/Appearance/Notification/Privacy/Chat settings, Group, Call
├── services/      websocket (backoff reconnect), offline outbox, push, media,
│                  update checks, realtime event bus
├── storage/       secure token store + local caches
├── theme/         light/dark/system + accent colors synced with server prefs
└── utils/         errors, formatting, validation
```

## Useful checks

```bash
npx expo export --platform android --output-dir dist-check && rm -rf dist-check
```

Verifies the whole dependency graph bundles cleanly without needing an EAS account.
