# NEXLINK — Real-time Messaging Platform

A modern messaging platform built with **Django**, **Django REST Framework**,
**Django Channels** (WebSockets) and a custom **vanilla HTML/CSS/JS** frontend.
No frontend framework — everything is server-rendered templates plus modular
JavaScript.

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
python manage.py test accounts messaging
# 73 tests covering auth flows, API authorization, models, WebSockets,
# per-user chat state, preferences and the dashboard page
```

## Project layout

```
manage.py
config/          settings.py · urls.py · asgi.py (Channels) · wsgi.py
accounts/        User + Profile + UserPreferences models, auth, preferences/avatar API
messaging/       Conversation/Message/MessageUserState/Notification models,
                 DRF views + serializers, WebSocket consumers, Nexus page views
templates/       base.html, accounts/*, messaging/dashboard.html
static/          css/{base,auth,chat}.css · js/{api,socket,nexus,auth}.js
media/           uploaded profile pictures (dev)
```

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
| PATCH  | `/api/conversations/<id>/state/` | pin/mute/archive/hide a chat (per user) |
| POST   | `/api/conversations/<id>/clear/` | hide all messages for self only |
| POST   | `/api/messages/<id>/star/` | toggle a star on a message |
| POST   | `/api/messages/<id>/pin/` | toggle a pin on a message |
| GET    | `/api/messages/starred/` | all starred messages |
| GET/PATCH | `/api/auth/preferences/` | synced theme/accent/toggles/status |
| GET/PATCH | `/api/auth/me/full/` | profile + preferences (PATCH updates profile) |
| POST   | `/api/auth/avatar/` | upload profile picture |
| GET    | `/api/notifications/` | recent notifications |

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
