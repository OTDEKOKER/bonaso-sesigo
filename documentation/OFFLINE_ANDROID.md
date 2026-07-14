# Offline-first Android build (DHIS2 Tracker Capture style)

The published Android app currently loads `https://sesigo.org.bw` in a WebView
(`capacitor.config.ts` → `server.url`), so it needs internet just to launch.
To make it work like the DHIS2 Tracker Capture app — open offline, capture data,
sync when back online — the web app must be **bundled inside the APK** and talk
to the API only for sync.

This is an opt-in build (`CAP_LOCAL_BUNDLE=1`); the default build is unchanged so
the currently-published app keeps working until the bundled release is tested.

## What already works (no APK rebuild needed)

The installable **browser PWA** ("Add to Home Screen" on Android Chrome) already
delivers the offline behaviour:

- `GET /api/offline/bootstrap/` downloads the worker's scoped package (profile,
  projects, organisation + coordinator + sub-grantees, indicators, forms,
  target groups, districts/localities, reporting periods, validation rules, and
  assigned respondents). Stored in IndexedDB (`lib/offline/local-store.ts`).
- Captured aggregates / respondents / interactions queue offline and replay on
  reconnect with a fresh token (`lib/offline/mutation-queue.ts`).
- **Offline login**: after one online login the device can log in offline by
  password (PBKDF2 verifier + AES-GCM-encrypted tokens, `lib/offline/offline-auth.ts`).
- Reference data is served all-shift offline (the 15-min TTL only applies online).

So the fastest path to field use is: install the PWA. The native APK below is for
Play Store / managed-device distribution.

## Building the local-bundle APK

The app uses a Next.js API proxy route (`app/api/[[...path]]/route.ts`) which a
static export cannot run, so the bundled app must call the backend **directly**.

1. Build the web assets and copy them into `mobile-shell/` (the Capacitor
   `webDir`). Point the app at the API directly:

   ```bash
   export NEXT_PUBLIC_API_BASE_URL=https://sesigo.org.bw/api
   npm run build:mobile-shell     # produce static assets into ./mobile-shell
   ```

   (If a `build:mobile-shell` script does not yet exist, add one that outputs the
   built client app into `mobile-shell/`. With the API base set to an absolute
   URL the client bypasses the Next proxy and calls Django directly.)

2. Sync and build the APK with local bundling on:

   ```bash
   CAP_LOCAL_BUNDLE=1 npx cap sync android
   CAP_LOCAL_BUNDLE=1 npx cap open android   # or ./android/gradlew assembleRelease
   ```

3. Backend CORS — allow the app origin so direct API calls succeed. In `.env`:

   ```
   CORS_ALLOWED_ORIGINS=https://sesigo.org.bw,capacitor://localhost,https://localhost
   ```

## On-device test checklist

- [ ] Install APK, open with **Wi-Fi off** → app launches (not a blank/spinner).
- [ ] Log in online once with Wi-Fi on; confirm "Downloaded offline package" toast.
- [ ] Turn Wi-Fi off, fully close + reopen the app, log in by password → succeeds.
- [ ] Capture an aggregate + a respondent offline → shows "queued".
- [ ] Turn Wi-Fi on → queue auto-syncs; records appear on the server.
- [ ] Log out → offline package + credential are wiped (shared-device safety).
- [ ] Repeat the whole flow in Training Mode → only training data downloads/syncs.

## Notes

- Bump `versionCode`/`versionName` in `android/app/build.gradle` for the store.
- Offline login stores only a salted PBKDF2 verifier + encrypted tokens, never the
  password. Pair with device lock / MDM. Cleared on explicit logout.
