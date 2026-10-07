# NEXLINK — Real-time Messaging Platform (Web + PWA + Android)

A modern messaging platform built with **Django**, **Django REST Framework**,
**Django Channels** (WebSockets) and a custom **vanilla HTML/CSS/JS** frontend.
One shared backend serves the **website**, the **installable PWA** and the
**Android app** (Expo/React Native in `mobile-app/`) — same accounts,
same conversations, same real-time delivery everywhere.

**Version 1.1.0**

## Features

### Authentication (accounts app)
- Registration with live username-availability checks and password strength meter
- Login with **username or email**, remember-me, show/hide password
- Password reset flow by email (console backend in development)
- Profile page: avatar, display name, bio, online/offline, last seen
- Account settings: edit profile, change email, upload picture
- CSRF protection, hashed passwords (Django's auth stack), protected pages

### Messaging (messaging app)
- Nexus dashboard: icon rail, filter chips (All/Unread/Pinned/Groups/Archived), dark/light themes with synced accent colour
- Per-user chat state: pin, mute, archive, hide; per-user starred/pinned messages; clear-chat for self only
- Realtime delivery over WebSockets (Django Channels + Daphne) — no polling
- Typing indicator, online presence, last seen, synced preferences (theme/accent/toggles/status)
- Send / edit / soft-delete messages, replies, emoji reactions, attachments (image/video/audio/file)
- Read receipts (sent ✓ / read ✓✓) and unread badges
- User search by phone/email/name; contacts list; groups with admin management
- Auto-scroll, empty states, toasts, reconnect with exponential backoff
- Desktop three-pane layout and mobile list↔chat navigation with bottom nav

## Quick start

> **Note (this environment):** the project directory sits on Android storage
> (`/mnt/sdcard`) which is mounted `noexec` and forbids symlinks, so the
> virtualenv lives outside the project at `/opt/venvs/django-chat`. On a normal
> machine you can simply create `.venv` inside the project instead.

```bash
# Install Python 3.10+ on the computer, then run start_server.bat.
# The launcher uses that computer's Python and installs missing packages.
start_server.bat

# Manual alternative:
python -m pip install --user -r requirements.txt
python manage.py migrate
python manage.py runserver
#    → http://127.0.0.1:8000  (served by Daphne via ASGI)
```

Open two browsers (or one normal + one incognito), register two accounts, and
chat in real time.

## Tests

```bash
python manage.py test
# 105 tests covering auth flows, API authorization, models, WebSockets,
# per-user chat state, preferences, calls, media, search and the dashboard
```

## PWA (installable web app)

The dashboard is a full Progressive Web App:

- `static/manifest.json` — Nexlink branding, teal theme, maskable icon
- `static/service-worker.js` — app-shell caching + offline fallback
  (never caches private `/api/` or `/media/` responses)
- Install prompt: Chrome/Edge desktop, Android Chrome → “Install app”;
  iOS Safari → Share → “Add to Home Screen”
- Offline: cached shell opens, a banner shows **You are offline**, and
  messages you compose are queued (`nexus.outbox` in localStorage) and sent
  automatically when the connection returns
- Connection states render in a banner: Connecting… / Reconnecting… /
  You are offline / connected (banner hides)
- **Real push notifications (even with every tab closed):** enable in
  Settings → Notifications → *Device notifications*. The browser stores a
  Web Push subscription (VAPID-signed); the server wakes it for new messages
  and incoming calls. Per-conversation stacking, tap → opens that chat.

## Project layout

```
manage.py
config/          settings.py · urls.py · asgi.py (Channels) · wsgi.py · health.py
accounts/        User + Profile + UserPreferences + PushDevice, auth, push registry
messaging/       Conversation/Message/Call/Notification models, DRF views,
                 WebSocket consumers, Nexus page views
templates/       base.html, accounts/*, messaging/dashboard.html
static/          css/ · js/{api,socket,nexus}.js · manifest.json · service-worker.js
scripts/         start.sh · setup_mobile.bat · run_mobile.bat · build_apk.bat
mobile-app/      Expo (React Native) Android client — see below
media/           uploaded profile pictures (dev only; use object storage in prod)
```

## Android app (mobile-app/)

A real Expo (React Native) client — not a WebView wrapper. Same backend,
same accounts, real-time over WebSockets.

**Features:** login/registration with token persistence (expo-secure-store),
auto-login, conversation list with unread badges/mute/pin indicators,
chat with date separators + delivery ticks, pagination (older messages load
on scroll), image/camera/document attachments, voice notes (record + play),
typing + presence, connection manager with backoff reconnect, offline
outbox, push notifications (Expo push), profile editing, settings toggles.

### Run it

```bat
scripts\setup_mobile.bat     :: one-time: npm install
scripts\run_mobile.bat       :: Django + Expo dev server, scan QR with Expo Go
```

Manual: `cd mobile-app && npm install && npx expo start`

### Build the APK

```bat
scripts\build_apk.bat
```

This runs `npx eas-cli build --platform android --profile preview` (cloud
build; free expo.dev account needed) and prints the APK download link.
Manual equivalent:

```bash
cd mobile-app
npx eas-cli build --platform android --profile preview   # .apk
npx eas-cli build --platform android --profile production # .aab (Play Store)
```

The APK URL is printed by EAS at the end of the build (it is also visible at
https://expo.dev → your project → Builds). Install it on the phone by opening
the link (allow “Install unknown apps” when asked).

**Backend URL:** the app reads `EXPO_PUBLIC_API_URL` (falls back to
`https://nexlink-app.onrender.com`). For development set it before starting
Expo, e.g. `set EXPO_PUBLIC_API_URL=http://192.168.1.20:8000` (your PC's LAN
IP; `10.0.2.2` for the Android emulator).

## API overview (session-authenticated JSON)

| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| GET    | `/api/conversations/` | list conversations (+unread, last message) |
| POST   | `/api/conversations/start/` | open/fetch a 1:1 conversation `{user_id}` |
| GET/POST | `/api/conversations/<id>/messages/` | list / send messages |
| POST   | `/api/conversations/<id>/read/` | mark conversation read |
| PATCH  | `/api/messages/<id>/edit/` | edit own message `{body}` |
| DELETE | `/api/messages/<id>/delete/` | soft-delete own message |
| POST   | `/api/messages/<id>/react/` | toggle emoji reaction `{emoji}` |
| GET    | `/api/users/search/?q=` | find users to chat with |
| POST   | `/api/contacts/match/` | match phone/email contact identifiers against registered users (never stored; safe fields only) |
| GET    | `/api/contacts/suggestions/` | People You May Know, ranked by mutual contacts / shared groups |
| GET/PATCH | `/api/auth/preferences/` | includes contact-discovery privacy toggles (`discoverable_by_phone/email/in_suggestions`) |
| PATCH  | `/api/conversations/<id>/state/` | pin/mute/archive/hide a chat (per user) |
| POST   | `/api/conversations/<id>/clear/` | hide all messages for self only |
| POST   | `/api/messages/<id>/star/` | toggle a star on a message |
| POST   | `/api/messages/<id>/pin/` | toggle a pin on a message |
| GET    | `/api/messages/starred/` | all starred messages |
| GET/PATCH | `/api/auth/preferences/` | synced theme/accent/toggles/status |
| GET/PATCH | `/api/auth/me/full/` | profile + preferences (PATCH updates profile) |
| POST   | `/api/auth/avatar/` | upload profile picture |
| POST   | `/api/auth/push/register/` | register Expo push token `{token}` |
| POST   | `/api/auth/push/unregister/` | remove a push token (logout) |
| GET    | `/api/auth/push/config/` | public VAPID key for Web Push subscription |
| POST   | `/api/auth/push/subscribe/` | store browser Web Push subscription |
| POST   | `/api/auth/push/unsubscribe/` | remove browser Web Push subscription |
| POST   | `/api/chats/by-phone/` | start a chat from a phone number `{phone}` |
| GET    | `/api/calls/` | call history |
| GET    | `/health/` | unauthenticated health check (no login needed) |
| GET    | `/api/notifications/` | recent notifications |

Token auth (mobile): send `Authorization: Token <key>`; obtain the key from
`/api/auth/login/` or `/api/auth/register/`. WebSockets accept the same token
via `?token=<key>` for native clients (`accounts/ws_auth.py`).

## WebSockets

| Path | Purpose |
| ---- | ------- |
| `/ws/chat/<conversation_id>/` | per-conversation: messages, typing, presence, receipts |
| `/ws/notifications/` | per-user: conversation updates everywhere else |

Client → server events: `typing`, `read`, `presence.ping`
Server → client events: `message.new`, `message.edited`, `message.deleted`,
`message.read`, `typing.event`, `read.event`, `presence.event`,
`reaction.updated`, `conversation.new`

## Security notes

- All pages/APIs require authentication where appropriate; conversation access
  is checked on every request and every socket connection.
- Message bodies are rendered with `textContent` (never `innerHTML`) → XSS-safe.
- CSRF tokens required on all POSTs (DRF SessionAuthentication enforces them).
- Passwords hashed with Django's PBKDF2; custom close codes avoided in favor of
  standard close semantics for broad browser/server compatibility.

## Production checklist (out of scope for dev)

- `DEBUG=False`, real `DJANGO_SECRET_KEY` env var, `DJANGO_ALLOWED_HOSTS`
- Redis channel layer (`channels_redis`) instead of InMemory
- PostgreSQL, object storage for media, HTTPS + HSTS (settings already flip
  the secure flags when `DEBUG=False`)
