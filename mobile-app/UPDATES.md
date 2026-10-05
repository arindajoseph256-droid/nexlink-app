# Updates — OTA (EAS Update) and APK versioning

Nexlink Android has **two independent update channels**. Knowing which change goes
through which channel is the whole release discipline.

| Change type | Channel | Why |
| --- | --- | --- |
| JS / screens / styles / logic / assets | **OTA — EAS Update** | No store, no rebuild; installs pick it up on next launch |
| Native modules, permissions, `app.json` plugin changes, SDK upgrades, icon/splash, AndroidManifest | **New APK/AAB + version bump** | Runtime version changes; OTA cannot replace native code |

## 1. OTA (JavaScript / assets)

Configured in `app.json`:

```json
"updates": { "url": "https://u.expo.dev/<projectId>", "fallbackToCacheTimeout": 0, "checkAutomatically": "ON_LOAD" },
"runtimeVersion": { "policy": "appVersion" }
```

- **`runtimeVersion` = `appVersion` policy** — the runtime version equals `expo.version`
  (currently `1.2.0`). OTA updates only apply to binaries with the *same* runtime version.
- The app checks on launch **and on every foreground resume** (`expo-updates`
  `checkForUpdateAsync` → `fetchUpdateAsync`, never in a loop). A downloaded
  bundle is **applied automatically the moment the app is backgrounded** (and
  otherwise on the next launch via `ON_LOAD`) — installed APKs track every JS
  release with zero user action. The "Update ready" banner only offers an
  immediate restart for users who don't want to wait.
- Launch is never blocked waiting for an update (`fallbackToCacheTimeout: 0`).

**One-time activation** (requires an expo.dev account — do this before the first OTA):

```bash
cd mobile-app
npx eas login
npx eas init                 # prints the project ID
# → replace BOTH placeholders in app.json:
#     extra.eas.projectId  AND  updates.url (https://u.expo.dev/<that-id>)
```

**Publishing an OTA update:**

```bash
# bump nothing if the change is JS-only and the runtime hasn't changed
npx eas update --channel production -m "Fix composer bug, refresh settings UI"
# preview channel for APK builds:
npx eas update --channel preview -m "..."
```

**Hard rule:** if the diff touches `package.json` native deps, `app.json` plugins,
permissions, or anything under `ios/`/`android/` — do **not** rely on OTA. Ship a new
binary instead.

## 2. Binary updates (APK/AAB) via the server version gate

The app asks the backend on every start:

```
GET https://nexlink-app.onrender.com/api/mobile/version/?version=<installed>
```

Response drives the UX:

| Condition | App behavior |
| --- | --- |
| `update_available: true` (installed < `latest_version`) | Dismissible notice with `download_url` + release notes ("Update now / Later") |
| installed < `minimum_supported_version` (or server forces `update_required`) | Non-dismissable "Nexlink must be updated" |
| otherwise | silent |

The gate lives server-side (`messaging/mobile_version.py`, `MOBILE_VERSIONS` Django
setting) so **releasing a new APK never requires shipping a client change**:

```python
MOBILE_VERSIONS = {
    "latest_version": "1.2.0",
    "minimum_supported_version": "1.1.0",
    "update_required": False,               # emergency kill-switch
    "download_url": "https://.../nexlink-1.2.0.apk",  # official location only
    "release_notes": "Voice notes, notifications inbox, faster reconnect.",
}
```

The app **never sideloads or silently installs** anything — it opens the official
`download_url` (Play Store listing or your release server) and Android's installer
flow takes over.

## 3. Release process (end to end)

```text
1. Make code changes (web and/or mobile).
2. Test web:    python3 manage.py test        (126 tests)
3. Test mobile: npx expo export --platform android   (bundle sanity)
4. JS-only?  → npx eas update --channel production -m "…"
   Native?   → bump expo.version (1.2.0) AND android.versionCode (+1)
5. npx eas build --platform android --profile production   (AAB)
   npx eas build --platform android --profile preview      (APK for side-load)
6. Host the APK at the official download location.
7. Update MOBILE_VERSIONS on the server (latest_version, download_url, notes).
8. Installed apps detect the new binary on next start.
```

### Versioning conventions

- **patch** (1.1.1) — bug fixes, no new features
- **minor** (1.2.0) — compatible features (new screens, settings, media types)
- **major** (2.0.0) — breaking changes (new auth model, API incompatibilities)
- `android.versionCode` strictly increases with every binary release
  (`autoIncrement: true` in the production profile already handles this)
- `expo.version` bump = new runtime version = OTA updates from older runtimes
  stop applying (correct behavior — those binaries need the new native base)
