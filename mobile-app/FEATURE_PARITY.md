# Nexlink — Web vs Android feature-parity checklist

Ground truth: full code audit of `mobile-app/src/` against the web feature set
(`static/js/nexus.js`, `templates/`, DRF views). Every row reflects what the code
actually does today — nothing aspirational, nothing hidden.

**Legend**

| Mark | Meaning |
| --- | --- |
| ✅ DONE | Implemented on mobile against the real backend, verified (bundle/typecheck or live endpoint test) |
| 🟡 DONE (code) | Implemented against the real API, but needs a real-device / two-account test to confirm end-to-end |
| 🟠 PARTIAL | Works, with a stated limitation (what remains is listed) |
| 🔴 MISSING | Not on mobile yet — remaining work itemized |
| ⛔ BLOCKED | Needs something outside the app (native module, credentials, or backend endpoint) |
| ➖ N/A | Web-only or mobile-only concept |

---

## 1. Authentication

| Feature | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| Register (phone/email + validation) | ✅ | ✅ | ✅ DONE | Mirrors web rules; live username checks are web-only (server validates authoritatively anyway) |
| Login with phone **or** email | ✅ | ✅ | ✅ DONE | `/api/auth/login/`, friendly errors |
| Persistent login | ✅ | ✅ | ✅ DONE | Token in expo-secure-store (device keychain) |
| Session restore on restart | ✅ | ✅ | ✅ DONE | Cached user paints instantly → `/api/auth/me/full/` verify |
| Logout | ✅ | ✅ | ✅ DONE | Clears keychain, unregisters push token, closes sockets |
| Invalid/expired token handling | ✅ | ✅ | ✅ DONE | Any 401 app-wide → session cleared, login shown |
| Forgot password | ✅ | ✅ | ✅ DONE | Opens the server's reset page (server emails the link) |
| Production API guard | ➖ | ✅ | ✅ DONE | localhost/LAN URLs rejected; safe fallback to `https://nexlink-app.onrender.com` |
| Startup connectivity diagnostics | ➖ | ✅ | ✅ DONE | `/health/` probe, explicit message + **Retry**; offline boot no longer logs you out |

**Remaining work: none.**

## 2. Messaging

| Feature | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| Real-time send/receive (WS) | ✅ | ✅ | ✅ DONE | Same `/ws/chat/<id>/` + `/ws/notifications/`, token auth |
| Message history + pagination | ✅ | ✅ | ✅ DONE | Inverted FlatList; older page on scroll-up |
| Timestamps, date separators | ✅ | ✅ | ✅ DONE | |
| Delivery/read ticks | ✅ | ✅ | ✅ DONE | ✓ / ✓✓ / ◷ (queued) from `message.read` events |
| Typing indicators | ✅ | ✅ | ✅ DONE | Debounced `typing` events, 3s timeout |
| Replies (quote) | ✅ | ✅ | ✅ DONE | Composer reply bar + quoted block in bubble |
| Reactions | ✅ | ✅ | 🟡 DONE (code) | Same quick picker as web (❤️😂👍😮😢🔥), own-reaction highlight, tap-pill toggle, WS count sync — needs on-device retest after the auth fix |
| Edit own message | ✅ | ✅ | ✅ DONE | `message.edited` live update |
| Delete for everyone | ✅ | ✅ | ✅ DONE | Soft delete, live tombstone |
| Delete for me | ✅ | ✅ | ✅ DONE | MessageVisibility |
| Copy text | ✅ | ✅ | ✅ DONE | expo-clipboard |
| Star / pin messages | ✅ | ✅ | ✅ DONE | Long-press actions; ★/📌 shown on bubble |
| Long-press action sheet | ✅ | ✅ | ✅ DONE | react/reply/star/pin/copy/edit/delete×2/download |
| Offline outbox (queue + auto-flush) | ✅ | ✅ | ✅ DONE | SecureStore, `client_id` dedupe, flush on reconnect/foreground |
| Starred-messages list screen | ✅ | ✅ | 🟡 DONE (code) | `StarredMessagesScreen` — list, open chat, unstar; entry in Settings → Chats |
| Message-history text search | ✅ | ✅ | 🟡 DONE (code) | server endpoint `/api/search/messages/`; PEOPLE + 💬 MESSAGE sections in the chats search bar |
| Message context in notifications inbox | ✅ | ✅ | ✅ DONE | `/api/notifications/` list, per-item mark-read, tap → chat |

**Remaining work: none** (device test pass still pending for the new screens).

## 3. Conversations

| Feature | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| Conversation list + last message + unread badges | ✅ | ✅ | ✅ DONE | |
| Server-backed user search | ✅ | ✅ | ✅ DONE | `/api/users/search/` incl. masked phone |
| Start chat from phone number | ✅ | ✅ | ✅ DONE | `/api/chats/by-phone/` |
| Online/offline + last seen | ✅ | ✅ | ✅ DONE | presence events; respects `last_seen_visible` |
| Typing state in list/header | ✅ | ✅ | ✅ DONE | header indicator in Chat |
| Pin / mute / archive chat | ✅ | ✅ | ✅ DONE | per-user state PATCH + long-press menu |
| Clear chat (self-only) | ✅ | ✅ | ✅ DONE | |
| Block / unblock user | ✅ | ✅ | ✅ DONE | server-enforced |
| Pull-to-refresh | ➖ | ✅ | ✅ DONE | |
| Realtime list refresh | ✅ | ✅ | ✅ DONE | event bus + focus re-validation |
| Filter chips (All/Unread/Pinned/Groups/Archived) | ✅ | ✅ | 🟡 DONE (code) | chip row over the list, same archived/pinned/unread/groups semantics as `nexus.js` |
| Contacts screen | ✅ | ✅ | 🟡 DONE (code) | `ContactsScreen` — list, tap → chat, remove; 👥 header entry + Settings row |
| Find People (contact discovery + PYMK) | ✅ | ✅ | 🟡 DONE (code) | `FindPeopleScreen` — device-contacts matching (expo-contacts, READ_CONTACTS rationale in app.json), People You May Know, permission-denied state + retry, invite via share sheet; web: New Chat → “Find people to chat with”. Server: `/api/contacts/match/` + `/api/contacts/suggestions/`; identifiers never stored; privacy toggles in Settings → Privacy |
| Shared-media grid per chat | ✅ | ✅ | 🟡 DONE (code) | `SharedMediaScreen` (Media/Links/Docs tabs) from the chat ⋮ menu |
| Report user | ✅ | ✅ | 🟡 DONE (code) | same five reasons as web, hooked into the chat ⋮ menu; server also blocks |
| Group vs DM routing | ✅ | ✅ | ✅ DONE | |

**Remaining work: none** (device test pass still pending for the new screens).

## 4. Groups

| Feature | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| Create group | ✅ | ✅ | ✅ DONE | name + members via real API |
| Group messaging | ✅ | ✅ | ✅ DONE | same WS rooms; sender labels |
| Group profile / members list | ✅ | ✅ | ✅ DONE | |
| Leave group | ✅ | ✅ | ✅ DONE | |
| Add member | ✅ | ✅ | 🟡 DONE (code) | `GroupAdminScreen` (admin-only picker) → `POST /api/groups/<id>/members/` |
| Remove / promote / demote member (admin) | ✅ | ✅ | 🟡 DONE (code) | all three admin-gated: remove, promote, and demote (`DELETE /api/groups/<id>/admins/<user_id>/`, last-admin guarded) |
| Edit group name/description | ✅ | ✅ | 🟡 DONE (code) | admin-only PATCH `/api/groups/<id>/` from `GroupAdminScreen` |

**Remaining work: none.**

## 5. Profiles

| Feature | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| Profile view/edit (display name, about) | ✅ | ✅ | ✅ DONE | `/api/auth/me/full/` |
| Avatar upload with **crop** | ✅ | ✅ | 🟡 DONE (code) | native square crop via `allowsEditing` + cache-bust — verify on device |
| Avatar render (authenticated) | ✅ | ✅ | ✅ DONE | `AuthenticatedImage` + `?token=` — fixed this session |
| Phone number (masked) | ✅ | ✅ | ✅ DONE | search results + profile |
| Online status / last seen | ✅ | ✅ | ✅ DONE | |
| Email change | ✅ | ✅ | 🟡 DONE (code) | `ChangeEmailScreen` → `POST /api/auth/email-change/` (uniqueness enforced server-side; tests added) |
| Change password | ✅ | ✅ | 🟡 DONE (code) | `ChangePasswordScreen` → `POST /api/auth/password-change/` (Django PasswordChangeForm; tests added) |
| Recovery email + account backup | ➖ (mobile-first) | ✅ | 🟡 DONE (code) | `RecoveryBackupScreen` — recovery email + `GET /api/auth/backup/` (JSON download) + `POST /api/auth/backup/email/` (emailed attachment); 4 tests |

**Remaining work: none.**

## 6. Settings (all synced to `/api/auth/preferences/` unless noted)

| Setting group | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| Settings hub reachable from main nav | ✅ | ✅ | ✅ DONE | header gear → hub → sub-screens |
| Account: profile card, avatar, edit | ✅ | ✅ | ✅ DONE | |
| Appearance: Light/Dark/System | ✅ | ✅ | ✅ DONE | ThemeProvider, system default, whole-app effect |
| Appearance: accent colors | ✅ | ✅ | ✅ DONE | same hex list as web (`nexus.js`) |
| Notifications: messages, sounds | ✅ | ✅ | ✅ DONE | server-synced toggles |
| Privacy: read receipts | ✅ | ✅ | ✅ DONE | server-enforced |
| Privacy: typing indicator | ✅ | ✅ | ✅ DONE | |
| Privacy: last seen | ✅ | ✅ | ✅ DONE | |
| Chats: enter-to-send | ✅ | ✅ | ✅ DONE | local persistence (instant) + server sync |
| Presence status (available/busy/away/dnd/invisible) | ✅ | ✅ | 🟡 DONE (code) | status chips in Settings → Privacy, synced via `/api/auth/preferences/` |
| Theme from server on login | ✅ | ✅ | ✅ DONE | two-way sync verified in Appearance screen |

**Remaining work: none.**

## 7. Calls

| Feature | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| Start voice/video call | ✅ | ✅ | 🟡 DONE (code) | real REST `/api/conversations/<id>/calls/` |
| Incoming ring / accept / decline / end | ✅ | ✅ | 🟡 DONE (code) | `call.*` WS events drive the full-screen modal |
| Signaling (offer/answer/ICE relay) | ✅ | ✅ | ✅ DONE | `/api/calls/<id>/signal/` reachable from client |
| P2P audio/video media | ✅ (browser WebRTC) | ⛔ | ⛔ BLOCKED — native module | needs react-native-webrtc (or similar) via EAS + two-device test. CallScreen states this honestly |
| Call history screen | ✅ | ✅ | 🟡 DONE (code) | `CallHistoryScreen` (`getCallHistory()`), entry in Settings → Calls |

**Remaining work:** media path (blocked as above); on-device call test.

## 8. Notifications

| Feature | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| In-app notifications inbox | ✅ | ✅ | ✅ DONE | real API list, mark all/one read, unread badge, live via WS |
| Tap notification → open chat | ✅ | ✅ | ✅ DONE | in-app modal + system-notification tap both navigate |
| Android notification channel | ➖ | ✅ | ✅ DONE | `nexlink-messages`, HIGH importance |
| Push permission request | ➖ | ✅ | ✅ DONE | Android 13+ POST_NOTIFICATIONS |
| Push token registration to user | ➖ | ✅ | ✅ DONE | `/api/auth/push/register/` |
| Foreground/background push delivery | ➖ | 🟡 | 🟡 DONE (code) | needs device test; prod APK builds additionally need FCM credentials (`eas credentials`) |
| **Real OS push with app/browser closed** | ✅ (Web Push) | ✅ (Expo push) | ✅ DONE | server fans out to every registered channel on new message + incoming call; web subscribes via VAPID (`/api/auth/push/config/`, `/api/auth/push/subscribe/`), Settings → Notifications toggle |
| Quiet/typing-aware suppression | ✅ (server) | ✅ | ✅ DONE | server honors mute/prefs before sending |

**Remaining work:** device test; FCM setup for store builds (account action).

## 9. Media & search

| Feature | Web | Android | Status | Notes / remaining work |
| --- | :-: | :-: | --- | --- |
| Gallery image picking | ✅ | ✅ | ✅ DONE | expo-image-picker |
| Camera capture (chat) | ✅ | ✅ | 🟡 DONE (code) | 📷 composer button → `pickImage({ fromCamera: true })` (permission handled in media service) |
| Document attachments | ✅ | ✅ | ✅ DONE | expo-document-picker |
| Media upload (image/video/audio/file) | ✅ | ✅ | ✅ DONE | multipart, 25MB cap, type whitelist enforced server-side |
| Image display in chat | ✅ | ✅ | ✅ DONE | `AuthenticatedImage` (token-fixed this session) |
| Image tap → full-screen viewer | ✅ | ✅ | ✅ DONE | `ImageViewerModal` (zoomable, download) on tap — PR #3 |
| Image/video/audio/file download | ✅ | ✅ | ✅ DONE | authenticated GET + Android share sheet |
| Voice notes: record + send | ✅ | 🟡 | 🟡 DONE (code) | expo-audio recorder → `sendAttachment('audio')` |
| Voice notes: playback | ✅ | 🟡 | 🟡 DONE (code) | in-bubble player (play/pause + progress) |
| Inline video player | ✅ | 🟠 | 🟠 PARTIAL | tap opens system player; inline expo-video player is a polish item |
| User search | ✅ | ✅ | ✅ DONE | server-backed |
| Conversation search | ✅ | ✅ | ✅ DONE | local list filter mirrors web's quick filter |
| Message text search | ✅ (filters) | ✅ | 🟡 DONE (code) | in-chat search (client-side, like web) + global message search via `/api/search/messages/` |

**Remaining work:** inline video player polish (small).

## 10. Platform / infrastructure

| Concern | Web | Android | Status |
| --- | :-: | :-: | --- |
| Same backend/database as web | ✅ | ✅ | ✅ DONE — one Django service, one DB |
| WebSocket reconnect (exp backoff) | ✅ | ✅ | ✅ DONE — 0.5s→15s, dup-guard |
| Foreground/background sync | ✅ | ✅ | ✅ DONE |
| Connection state UX | ✅ | ✅ | ✅ DONE — banner + per-screen notes |
| Theme parity (colors/bubbles) | ✅ | ✅ | ✅ DONE — tokens mirrored from `base.css` |
| OTA updates (JS/assets) | ➖ | ✅ | ✅ DONE (config) — EAS Update wired; activation needs `eas init` |
| APK version gate | ➖ | ✅ | ✅ DONE — `/api/mobile/version/` live in prod, tested |
| Push channel infra | ✅ | ✅ | ✅ DONE |
| Error states / retries everywhere | ✅ | ✅ | ✅ DONE |
| Accessibility | ✅ | 🟠 | 🟠 PARTIAL — labels + ≥40pt targets; full screen-reader audit pending |

---

## Consolidated remaining-work list (by size)

**Small UI jobs (API ready):**
1. Inline video player (tap currently opens the system player) — polish only
2. Full screen-reader/accessibility audit (labels + touch targets already in place)

**Done this pass (code complete, 🟡 needs device test):** filter chips, starred
screen, contacts screen, call history, shared-media grid, group admin
(add/remove/promote/rename), presence-status picker, email + password change
screens, camera capture button, report-user hook, message search (global +
in-chat), full-screen image viewer (PR #3).

**Device/account-dependent (cannot be closed from this machine):**
- On-device verification pass: reactions, avatar crop, downloads/share sheet, voice notes, push delivery,
  and every 🟡 row above (needs an installed APK + two accounts)
- FCM credentials for push in production APK builds (expo.dev account action)
- `eas init` to activate OTA delivery (replaces the documented placeholder project ID)

**Blocked — needs a module/decision:**
- Call P2P media: native WebRTC module via EAS, then two-device testing
