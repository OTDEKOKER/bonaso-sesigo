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

