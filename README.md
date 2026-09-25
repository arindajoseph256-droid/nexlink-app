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
- One-to-one conversations with sidebar list, last-message preview, unread counts
- Realtime delivery over WebSockets (Django Channels + Daphne) — no polling
- Typing indicator, online presence, last seen
- Send / edit / soft-delete messages, replies, emoji reactions
- Read receipts (sent ✓ / read ✓✓) and unread badges
- User search (by username or display name) to start new chats
- Auto-scroll, empty states, toasts, reconnect with exponential backoff
- Desktop two-pane layout and mobile list↔chat navigation

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
# 50 tests covering auth flows, API authorization, models and WebSockets
```

## Project layout

```
manage.py
config/          settings.py · urls.py · asgi.py (Channels) · wsgi.py
accounts/        User + Profile models, auth views/forms/urls, admin
messaging/       Conversation/Message/Reaction/Notification models,
                 DRF views + serializers, WebSocket consumers, page views
templates/       base.html, accounts/*, messaging/*
static/          css/{base,auth,chat}.css · js/{api,socket,chat,auth}.js
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
