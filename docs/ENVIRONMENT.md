# Environment variables

Copy `.env.example` (or this table) when configuring a machine.
**Never commit real secrets.**

## Django core

| Variable | Required | Notes |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | yes (prod) | `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"` |
| `DJANGO_DEBUG` | yes (prod) | `0` in production — enables HTTPS/HSTS flags and strict host checks |
| `DJANGO_ALLOWED_HOSTS` | prod | Comma-separated, e.g. `nexlink-app.onrender.com` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | prod | Absolute origins, e.g. `https://nexlink-app.onrender.com` |
| `CORS_ALLOWED_ORIGINS` | optional | Comma-separated origins allowed to call the API with token auth |

## Database & WebSockets

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | prod | Postgres connection string (Render injects it) |
| `CHANNEL_REDIS_URL` | prod | Redis connection string for the Channels layer |

## Phone handling

| Variable | Required | Notes |
| --- | --- | --- |
| `DEFAULT_PHONE_REGION` | optional | Region for numbers typed without a country code (default `US`; use e.g. `UG`) |

## Push notifications (Expo)

| Variable | Required | Notes |
| --- | --- | --- |
| `EXPO_ACCESS_TOKEN` | optional | Raises Expo push rate limits; free account at expo.dev. The Android app never embeds this value. |
| `EXPO_PUSH_URL` | no | Test override of the Expo push endpoint |

## Mobile app development

| Variable | Required | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | dev | Set in the shell before `npx expo start`. Emulator: `http://10.0.2.2:8000`; phone on LAN: `http://<PC-LAN-IP>:8000`. Release builds fall back to `https://nexlink-app.onrender.com`. |

## Render deployment

Set on the Render service (see `render.yaml`): `DJANGO_DEBUG=0`,
`DJANGO_SECRET_KEY` (generated), `DJANGO_ALLOWED_HOSTS=nexlink-app.onrender.com`,
`DJANGO_CSRF_TRUSTED_ORIGINS=https://nexlink-app.onrender.com`,
`DATABASE_URL` and `CHANNEL_REDIS_URL` (injected from the linked
Postgres/Redis), `PYTHON_VERSION=3.10.14`, optional `EXPO_ACCESS_TOKEN`.
