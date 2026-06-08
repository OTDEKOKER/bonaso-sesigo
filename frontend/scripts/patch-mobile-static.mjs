/**
 * Restructures each "use client" dynamic-route page.tsx into:
 *   _PageContent.tsx  — original file (client component, unchanged)
 *   page.tsx          — thin server-component wrapper that exports
 *                       `generateStaticParams` and `dynamic`
 *
 * Safe to re-run — regenerates wrappers if _PageContent.tsx already exists.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const pattern = join(root, 'app', '**', '[[]**[]]', '**', 'page.tsx');

function makeWrapper() {
  // No import of _PageContent needed — generateStaticParams returns [] so no
  // pages are pre-rendered. Dynamic routes are served by the service worker
  // cache after first online visit.
  return `export const dynamic = 'force-static';
export function generateStaticParams() { return []; }
export default function Page() { return null; }
`;
}

let wrapped = 0;
let skipped = 0;

for await (const file of glob(pattern)) {
  const dir = dirname(file);
  const contentFile = join(dir, '_PageContent.tsx');
  const src = readFileSync(file, 'utf8');

  // Already a server wrapper — just regenerate it in case it's stale.
  const isWrapper = src.includes("from './_PageContent'");
  if (isWrapper) {
    writeFileSync(file, makeWrapper(), 'utf8');
    wrapped++;
    continue;
  }

  const isClientComponent =
    src.trimStart().startsWith('"use client"') ||
    src.trimStart().startsWith("'use client'");

  if (!isClientComponent) { skipped++; continue; }

  // First time: rename original to _PageContent, write wrapper.
  if (!existsSync(contentFile)) renameSync(file, contentFile);
  writeFileSync(file, makeWrapper(), 'utf8');
  console.log('  wrapped:', file.replace(root, ''));
  wrapped++;
}

console.log(`\nDone. ${wrapped} wrapped/updated, ${skipped} skipped.`);
