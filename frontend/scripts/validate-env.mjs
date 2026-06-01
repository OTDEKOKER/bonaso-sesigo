import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envFiles = [".env.local", ".env"];

function parseEnvFile(filePath) {
  const out = {};
  const content = readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    out[key] = value;
  }

  return out;
}

const resolvedEnv = {};
for (const fileName of envFiles) {
  const filePath = join(root, fileName);
  if (!existsSync(filePath)) continue;
  Object.assign(resolvedEnv, parseEnvFile(filePath));
}
Object.assign(resolvedEnv, process.env);

const apiBase =
  resolvedEnv.BACKEND_API_URL ||
  resolvedEnv.NEXT_PUBLIC_API_URL ||
  resolvedEnv.NEXT_PUBLIC_API_BASE_URL ||
  "";

if (!apiBase) {
  console.error("Missing API base configuration.");
  console.error(
    "Set one of BACKEND_API_URL, NEXT_PUBLIC_API_URL, or NEXT_PUBLIC_API_BASE_URL in .env.local or .env before building.",
  );
  process.exit(1);
}

if (resolvedEnv.NEXT_PUBLIC_API_BASE_URL && !resolvedEnv.NEXT_PUBLIC_API_URL) {
  console.warn(
    "Using legacy NEXT_PUBLIC_API_BASE_URL. Consider renaming it to NEXT_PUBLIC_API_URL for consistency.",
  );
}

console.log(`Environment validation passed. API base is configured via ${apiBase}.`);
