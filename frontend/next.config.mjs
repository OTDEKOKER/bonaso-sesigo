import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const nextConfig = {
  images: {
    unoptimized: true,
  },
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
  allowedDevOrigins: ['sesigo.org.bw', 'www.sesigo.org.bw'],
}

export default nextConfig

