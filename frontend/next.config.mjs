import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IS_MOBILE_BUILD = process.env.MOBILE_BUILD === '1';
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8001/api';

const nextConfig = {
  images: {
    unoptimized: true,
  },

  // Static export for mobile APK bundle.
  ...(IS_MOBILE_BUILD ? {
    output: 'export',
    distDir: 'mobile-shell',
  } : {}),

  // Rewrites proxy /api/* to Django — server-side only, not used in static export.
  ...(!IS_MOBILE_BUILD ? {
    async rewrites() {
      return [
        { source: '/api/:path*/', destination: `${BACKEND_API_URL}/:path*/` },
        { source: '/api/:path*', destination: `${BACKEND_API_URL}/:path*` },
      ];
    },
  } : {}),

  // Security headers on the app pages (audit S1). `headers()` is unsupported by
  // `output: 'export'`, so it is only wired up for the server (non-mobile) build.
  //
  // - X-Content-Type-Options: nosniff is always safe and matches the backend.
  // - Content-Security-Policy is emitted ONLY when CONTENT_SECURITY_POLICY is
  //   set, so shipping this changes nothing until an operator opts in with a
  //   tested policy. Set CONTENT_SECURITY_POLICY_REPORT_ONLY=true to roll out in
  //   report-only mode first (browsers report violations without blocking), then
  //   switch to enforcing once the reports are clean. A CSP that is too strict
  //   will break the app, so this stays default-off deliberately.
  ...(!IS_MOBILE_BUILD ? {
    async headers() {
      const csp = (process.env.CONTENT_SECURITY_POLICY || '').trim();
      const reportOnly = /^(1|true|yes)$/i.test(
        (process.env.CONTENT_SECURITY_POLICY_REPORT_ONLY || '').trim()
      );
      const headers = [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ];
      if (csp) {
        headers.push({
          key: reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
          value: csp,
        });
      }

      // Immutable caching for static, non-user-specific assets only. JS/CSS
      // chunks under /_next/static are content-hashed (Next already marks them
      // immutable); this adds the same for shared public images, fonts and the
      // static map GeoJSON (fetched on every CSO-map load). Deliberately EXCLUDES
      // .js / .json so the service worker and web manifest keep revalidating and
      // can ship updates.
      //
      // Authenticated data is NEVER cached at this layer — it flows through
      // /api/*, which is per-user / per-project / per-mode and is marked
      // private/no-store per request by the backend
      // (core.middleware.ApiCacheControlMiddleware). It must never be shared- or
      // edge-cached.
      const immutableStaticAssets = {
        source: '/:all*(svg|jpg|jpeg|png|gif|ico|webp|avif|geojson|woff|woff2|ttf|otf)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      };

      return [
        { source: '/:path*', headers },
        immutableStaticAssets,
      ];
    },
  } : {}),

  typescript: {
    // Production builds on this host intermittently fail in the Next build worker
    // after app compilation completes. We run lint/type checks separately.
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: __dirname,
  },

  // Match Django/DRF default trailing-slash API style to avoid redirect loops.
  trailingSlash: true,
  skipTrailingSlashRedirect: true,

  // Restrict development origins to the canonical deployed domain.
  // This list is hostnames (not full URLs).
  allowedDevOrigins: ['sesigo.org.bw', 'www.sesigo.org.bw', '192.168.0.7'],
}

export default nextConfig

