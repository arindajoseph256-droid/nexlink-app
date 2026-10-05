# SKILL.md — NEXLINK

Agent-facing guide to working in this repository. Read this before changing code.

## What this project is

NEXLINK is a real-time messaging platform with **three clients on one backend**:

| Client | Path | Stack |
| --- | --- | --- |
| Website + PWA | `templates/`, `static/` | Django templates, vanilla JS (`static/js/nexus.js`), CSS |
| Android app | `mobile-app/` | Expo / React Native (SDK 57), JS (no TypeScript) |
| Backend/API | `config/`, `accounts/`, `messaging/` | Django 5 + DRF + Channels (WebSocket) |

Production: https://nexlink-app.onrender.com (Render, `autoDeploy: true` on `main`).
Every push/PR to `main` runs `.github/workflows/django.yml` and
`python-app.yml`: `python manage.py test` + `flake8 --select=E9,F63,F7,F82`.

## Ground rules

1. **No WebView, no mocks on mobile.** The Android app is a real native client
   hitting the same REST + WebSocket API as the web app.
2. **Feature parity is tracked in `mobile-app/FEATURE_PARITY.md`** (107-row
   audit). When you add/finish a feature, update its row in the same commit.
   Status marks: ✅ DONE, 🟡 DONE (code, needs device test), 🟠 PARTIAL,
   🔴 MISSING, ⛔ BLOCKED, ➖ N/A.
3. **Mobile ↔ backend contracts are verified against both sides.** Before
   touching an endpoint, read its view *and* the mobile wrapper that calls it
   (`mobile-app/src/api/*.js`). Field names differ between web and mobile
   (`unread_count` vs `unread`, `attachment` multipart field, `avatar`).
4. **Token auth for native, session auth for web.** Mobile sends
   `Authorization: Token <key>`; `<Image>`/downloads/WebSockets use
   `?token=<key>` (`accounts/ws_auth.py`, `avatar_auth_required`,
   `messaging/authentication.py`). Never remove the query-token paths.
5. Edit files with the file tools (`write_file`/`str_replace`), not shell
   redirection. Python changes: run the tests (below). Mobile changes: run the
   bundle export (below).

## Commands

```bash
# Backend tests (143 passing) — run after ANY accounts/ or messaging/ change
python3 manage.py test

# SEO self-check (16 checks)
python3 manage.py check_seo

# Lint gate used by CI
python3 -m flake8 --select=E9,F63,F7,F82 .

# Mobile bundle sanity check (~1–2 min; proves every import resolves)
cd mobile-app && npx expo export --platform android --output-dir dist-check
# then: rm -rf dist-check

# Mobile dependencies (Bun is the workspace default; lockfile in repo is npm —
# use npm if you must keep package-lock.json consistent)
cd mobile-app && npm install
```

Do **not** run `bun run build` / production builds, and do not start dev
servers from the terminal — the Freebuff platform owns the preview/Convex-style
managed processes.

## Backend map

- `config/` — settings, urls (`/api/auth/` → `accounts.api_urls`,
  `/api/` → `messaging.urls`), asgi (Channels), health endpoint `/health/`.
- `accounts/` — custom User (phone-first, E.164, optional email), Profile
  (avatar → `/accounts/users/<id>/avatar/`), UserPreferences (synced theme/
  accent/toggles), push devices.
  - Web pages: `views.py` + `urls.py` (register/login/settings/password reset).
  - Native API: `api_urls.py` + `api_views.py` + `api_preferences.py`
    (login, register, me/full, preferences, avatar, push,
    **password-change**, **email-change**, **backup** JSON download,
    **backup/email** — sends the export to the recovery address).
- `messaging/` — Conversation/Message/Call/Notification, DRF views
  (`views.py` ~1250 lines), consumers (chat + notification sockets),
  serializers (`MessageSerializer` is the single message payload shape).
  Key endpoints: conversations, messages (+`?before=` paging), react/star/pin,
  `search/messages`, `search/conversations`, contacts, block/report,
  groups (`/api/groups/<id>/…` members/admins), conversation state,
  media gallery, calls, notifications, `mobile/version`.
- Tests: `accounts/tests.py`, `messaging/tests.py` (~143 total). Add a test
  for every new endpoint; CI fails the PR otherwise.
- Unauthenticated DRF responses answer **403** here (session auth default) —
  tests assert `assertIn(status, (401, 403))`.

## Mobile map (`mobile-app/src/`)

- `api/` — one wrapper file per resource; `client.js` handles token header,
  skips JSON Content-Type for `FormData`, global 401 → session clear,
  offline detection. `config.js` is the source of truth for `APP_VERSION`,
  `APP_BUILD`, `APP_VERSION_LABEL` (keep in sync with `app.json` +
  `package.json` + `messaging/mobile_version.py`).
- `screens/` — Conversations (filter chips All/Unread/Pinned/Groups/Archived,
  people + message search), Chat (WS, reactions, attachments, in-chat search,
  report/block menu, media + group-settings entries), Starred, Contacts,
  SharedMedia, GroupAdmin (create is `GroupScreen`), settings tree incl.
  ChangeEmail / ChangePassword, Call, auth screens.
- `navigation/MainNavigator.js` — register every new screen here; screens read
  `route.params` (e.g. `{ conversation }`).
- `components/` — `ui.js` (Avatar/SettingsRow/SectionTitle/…),
  `MessageBubble.js`, `ImageViewerModal.js`, `AuthenticatedImage.js`
  (appends `?token=`; required for every remote image).
- `services/` — `websocket.js` (ManagedSocket w/ backoff), `offlineQueue.js`
  (SecureStore outbox), `realtimeBus.js`, `syncService.js`, `notifications.js`.
- Hooks must come from `react` only; no conditional hook calls; keep styling
  in the existing theme tokens (`theme/colors.js`, `useTheme`/`ThemeContext`).

## Feature status & known blockers

- Full parity audit: `mobile-app/FEATURE_PARITY.md`.
- **Blocked:** P2P audio/video calls on Android need `react-native-webrtc`
  (native module → must ship through an EAS build; not Expo Go).
- **OTA updates:** `mobile-app/app.json` still has placeholder
  `projectId`/`updates.url`. Running `npx eas init` in `mobile-app/` replaces
  them and enables JS-only OTA delivery.
- **APK builds:** `cd mobile-app && npx eas-cli build --platform android
  --profile preview` (free expo.dev account; prints download URL).
  The installed APK must show `Nexlink 1.2.0 (build 3)` on the login footer.
- **Release flow (two channels — details in `mobile-app/UPDATES.md`):**
  - *JS/screens/styles/assets* → `eas update --branch <branch>` → installed APKs
    auto-check on launch **and every foreground resume**, and a fetched bundle
    auto-applies when the app is backgrounded or next launched
    (`updates.checkAutomatically: ON_LOAD`). One-time activation needs
    `npx eas login && npx eas init` (replaces the placeholder projectId).
  - *Native changes / plugins / SDK* → bump `app.json` `version` +
    `android.versionCode`, `package.json`, `APP_VERSION`/`APP_BUILD` in
    `src/api/config.js`, and `latest_version` in
    `messaging/mobile_version.py` → new APK build → installed apps are
    prompted via `/api/mobile/version/` (set `MOBILE_VERSIONS.download_url`
    for a one-tap "Update now").

## Docs

- `README.md` — product overview, API table, quick start.
- `mobile-app/README.md`, `mobile-app/UPDATES.md` — Android client docs.
- `mobile-app/FEATURE_PARITY.md` — the parity audit (update on every feature
  change).
