import type { CapacitorConfig } from "@capacitor/cli";

const DEFAULT_SERVER_URL = "https://sesigo.org.bw";
const serverUrl = process.env.CAP_SERVER_URL || DEFAULT_SERVER_URL;

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
