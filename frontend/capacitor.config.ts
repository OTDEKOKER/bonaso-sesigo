import type { CapacitorConfig } from "@capacitor/cli";

// Two packaging modes:
//
//  Remote wrapper (default, == the currently-published app): the APK loads the
//  live site over the network via server.url. Simple, but needs internet to
//  launch — not truly offline-first.
//
//  Local bundle (CAP_LOCAL_BUNDLE=1, DHIS2 Tracker Capture style): the built web
//  app ships inside the APK (webDir) and there is NO server.url, so the app
//  launches with no internet and only calls the API to sync. Requires:
//    1. Build the web app into ./mobile-shell (see docs/OFFLINE_ANDROID.md).
//    2. Point the app at the API directly:  NEXT_PUBLIC_API_BASE_URL=https://sesigo.org.bw/api
//    3. Add the app origin to CORS_ALLOWED_ORIGINS on the backend
//       (capacitor://localhost and https://localhost).
//
// Default is unchanged so the published app keeps working until a local-bundle
// release is built and tested on-device.
const LOCAL_BUNDLE = process.env.CAP_LOCAL_BUNDLE === "1";
const DEFAULT_SERVER_URL = "https://sesigo.org.bw";
const serverUrl = LOCAL_BUNDLE ? "" : (process.env.CAP_SERVER_URL || DEFAULT_SERVER_URL);

const config: CapacitorConfig = {
  appId: "org.bonaso.dataportal",
  appName: "BONASO Data Portal",
  webDir: "mobile-shell",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
      }
    : undefined,
};

export default config;
