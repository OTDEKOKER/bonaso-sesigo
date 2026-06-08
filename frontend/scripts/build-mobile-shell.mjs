/**
 * Build the Next.js app as a static export for the Android local-bundle APK.
 *
 * Usage:
 *   node scripts/build-mobile-shell.mjs                          # local network (dev)
 *   API_URL=https://sesigo.org.bw/api node scripts/build-mobile-shell.mjs  # production
 *
 * Dynamic route pages and server-only handlers are hidden during the build.
 * They are served by the Android SPA fallback + service worker cache after
 * the first online visit.
 */
import { execSync } from 'node:child_process';
import { renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { glob } from 'node:fs/promises';

const apiUrl = process.env.API_URL || 'http://192.168.0.7:8001/api';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

console.log(`Building mobile shell → API: ${apiUrl}`);
console.log('Output: frontend/mobile-shell/\n');

// Collect all files to hide: the API proxy route + every dynamic-route page.
const filesToHide = [
  join(root, 'app', 'api', '[[...path]]', 'route.ts'),
];
const dynamicPagePattern = join(root, 'app', '**', '[[]**[]]', '**', 'page.tsx');
for await (const f of glob(dynamicPagePattern)) filesToHide.push(f);

// Also hide _PageContent.tsx files (client component copies) to avoid
// residual imports being processed during the build.
const contentPattern = join(root, 'app', '**', '_PageContent.tsx');
for await (const f of glob(contentPattern)) filesToHide.push(f);

const hidden = [];
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  for (const { src, bak } of hidden) {
    if (existsSync(bak)) renameSync(bak, src);
  }
}
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(1); });

for (const src of filesToHide) {
  if (!existsSync(src)) continue;
  const bak = src + '.bak';
  renameSync(src, bak);
  hidden.push({ src, bak });
}
console.log(`Hidden ${hidden.length} files from static export.\n`);

process.env.MOBILE_BUILD = '1';
process.env.NEXT_PUBLIC_API_BASE_URL = apiUrl;
process.env.NEXT_PUBLIC_API_URL = apiUrl;
process.env.NODE_ENV = 'production';

try {
  execSync('npx next build', { stdio: 'inherit' });
  console.log('\nMobile shell built. Run `npm run mobile:sync` next.');
} finally {
  restore();
}
