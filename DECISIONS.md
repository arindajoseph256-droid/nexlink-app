# DECISIONS.md

Shortcut / deviation log, as required by the Nexus master prompt ("If a shortcut
is taken, document it in DECISIONS.md").

## D1 — Stack: Django instead of Fastify/Prisma/Socket.IO (approved by owner)

The master prompt locked Phase 0 to Node + TypeScript + Fastify + Prisma +
Socket.IO + MinIO + BullMQ. The project already had a working Django 5 + DRF +
Channels backend in production (Render) with phone-first auth, WebSockets,
reactions, groups, contacts, blocks, notifications and synced preferences.
Rebuilding it on the locked stack would discard working, deployed software for
an equivalent rewrite.

**Owner decision (2026-09-26): keep Django.** Mapping of the locked stack to
what is actually used:

| Locked choice | Actual | Notes |
| --- | --- | --- |
| Fastify + TS | Django 5 + DRF | same REST surface, `/api/...` prefix |
| PostgreSQL + Prisma | PostgreSQL (Render) / SQLite (dev) + Django ORM | `DATABASE_URL` driven |
| Redis 7 pub-sub | Redis channel layer (Channels) | `CHANNEL_REDIS_URL` |
| Socket.IO | Django Channels WebSockets | same event model, `/ws/chat/<id>/`, `/ws/notifications/` |
| MinIO / S3 | Django FileField on local disk (S3-compatible storage is a config swap) | media endpoint already serves signed-ish downloads |
| BullMQ | Django synchronous fan-out (async queue not yet needed at current scale) | revisit at load |
| Zod | DRF serializers + Django validators | shared-schema goal served by serializers |
| Twilio Verify OTP | Django session auth (password + phone) | OTP provider is an isolated future swap |

Everything else in the master prompt (feature scope, acceptance behavior,
"no stubs" rule) applies unchanged.

## D2 — Calls scope (Phase 6.1)

1:1 (DM) voice + video calls with real WebRTC media (STUN via Google,
signaling relayed through the existing chat socket). Group calls, call
recording and call push notifications are deferred — they need SFU/multi-peer
work that does not fit the 1:1 signaling path.

## D3 — Media (Phase 6.2)

The gallery/lightbox works from messages already in the chat (images, video,
files, URLs). Server-side image resizing/thumbnails/blurhash and video
transcoding (Phase 3.4 processing pipeline) are deferred; uploads are stored
and served as-is with the existing 25 MB guard.

## D4 — Dashboard rebrand: one palette with the auth pages

The Nexus dashboard used a "Midnight Violet" palette (purple accents,
aubergine dark surfaces) while the login/register pages use the deep-teal
welcome design (#071d22 surfaces, #74ffd6 mint, #00a884 teal, ivory text).
The owner asked for one consistent brand, so the dashboard adopts the auth
palette: both theme token blocks, all hardcoded violet literals, the JS
accent defaults, and the `UserPreferences.accent` DB default were switched.
Saved pre-rebrand violet accents are remapped to the teal family client-side
(`LEGACY_ACCENT` in nexus.js), so no data migration of existing user prefs is
needed. Users who explicitly pick a non-violet accent keep it.
