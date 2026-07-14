# Android / Play Store Release Guide

This project uses Capacitor to ship the BONASO web app as an Android application.

## 1. Prerequisites
- Node.js 20.11.1+
- Android Studio (latest stable)
- Android SDK + emulator/device
- A deployed HTTPS URL for this frontend: `https://sesigo.org.bw`
- Google Play Console account

## 2. Configure app URL
The Android app loads your deployed web app via `CAP_SERVER_URL`.

Bash (WSL/macOS/Linux):
```bash
export CAP_SERVER_URL="https://sesigo.org.bw"
npm run mobile:sync
```

PowerShell (Windows):
```powershell
$env:CAP_SERVER_URL="https://sesigo.org.bw"
npm run mobile:sync
```

## 3. Open Android project
```bash
npm run mobile:open:android
```

In Android Studio:
1. Wait for Gradle sync.
2. Set package ID and app name if needed.
3. Build and run on emulator/device.

## 4. Build Play Store artifact (.aab)
In Android Studio:
1. `Build` -> `Generate Signed Bundle / APK`.
2. Choose `Android App Bundle`.
3. Create/use upload keystore.
4. Build `release` bundle.

Output is typically in:
- `android/app/release/app-release.aab`

## 5. Upload to Play Console
1. Create app entry.
2. Complete:
   - App content (target audience, ads, etc.)
   - Data safety
   - Privacy policy URL
   - Store listing assets (icon, screenshots, feature graphic)
3. Upload `.aab` to internal testing first.
4. Run pre-launch checks, then promote to production.

## Notes
- If `CAP_SERVER_URL` is not set, the app uses the default live URL in `capacitor.config.ts` (`https://sesigo.org.bw`).
- After any Capacitor/plugin/config change, run `npm run mobile:sync`.
- Offline behavior:
  - First launch must be online so service worker/cache can warm.
  - After a successful online launch, previously visited pages and cached API responses are available offline.
  - Queued write actions sync automatically when connectivity returns.
