import http from 'node:http'
import https from 'node:https'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const backendApiBase =
  process.env.BACKEND_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'https://sesigo.org.bw/api'

const normalizedBackendApiBase = backendApiBase.replace(/\/+$/, '')
const backendApiUrl = new URL(normalizedBackendApiBase)

const hopByHopHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function buildTargetUrl(request: NextRequest) {
  const requestPath = request.nextUrl.pathname.replace(/^\/api/, '')
  const targetUrl = new URL(backendApiUrl.toString())

  targetUrl.pathname = `${backendApiUrl.pathname.replace(/\/+$/, '')}${requestPath}` || '/'
  targetUrl.search = request.nextUrl.search

  return targetUrl
}

function getForwardedHost(targetUrl: URL) {
  if (process.env.BACKEND_PROXY_HOST_HEADER) {
    return process.env.BACKEND_PROXY_HOST_HEADER
  }

  return targetUrl.host
}

// Audit finding M3: forward only an explicit allowlist of request headers to the
// Django backend instead of relaying every client-supplied header. This shrinks
// the header-injection / request-smuggling surface. The x-forwarded-* and host
// headers are set deliberately below; auth/content/conditional headers are the
// only client headers the API actually needs.
const forwardableRequestHeaders = new Set([
  'authorization',
  'content-type',
  'accept',
  'accept-language',
  'cookie',
  'x-csrftoken',
  'x-requested-with',
  'user-agent',
  'range',
  'if-none-match',
  'if-modified-since',
])

function buildRequestHeaders(request: NextRequest, targetUrl: URL, bodyLength: number) {
  const headers = new Map<string, string>()

  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase()
    if (hopByHopHeaders.has(lower)) {
      continue
    }
    if (!forwardableRequestHeaders.has(lower)) {
      continue
    }

    headers.set(key, value)
  }

  headers.set('host', getForwardedHost(targetUrl))
  headers.set('x-forwarded-host', request.headers.get('host') ?? request.nextUrl.host)
  headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''))

  if (bodyLength > 0) {
    headers.set('content-length', String(bodyLength))
  }

  return Object.fromEntries(headers)
}

function buildResponseHeaders(headers: http.IncomingHttpHeaders) {
  const responseHeaders = new Headers()

  for (const [key, value] of Object.entries(headers)) {
    if (!value || hopByHopHeaders.has(key.toLowerCase())) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        responseHeaders.append(key, item)
      }

      continue
    }

    responseHeaders.set(key, value)
  }

  return responseHeaders
}

async function handleRequest(request: NextRequest) {
  const targetUrl = buildTargetUrl(request)
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : Buffer.from(await request.arrayBuffer())

  return new Promise<Response>((resolve) => {
    const transport = targetUrl.protocol === 'https:' ? https : http
    const upstreamRequest = transport.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || undefined,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: request.method,
        headers: buildRequestHeaders(request, targetUrl, body?.length ?? 0),
      },
      (upstreamResponse) => {
        const chunks: Buffer[] = []

        upstreamResponse.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        upstreamResponse.on('end', () => {
          resolve(
            new Response(request.method === 'HEAD' ? null : Buffer.concat(chunks), {
              status: upstreamResponse.statusCode ?? 502,
              headers: buildResponseHeaders(upstreamResponse.headers),
            }),
          )
        })
      },
    )

    upstreamRequest.on('error', (error) => {
      resolve(
        NextResponse.json(
          {
            detail: `Cannot reach backend at ${targetUrl.origin}.`,
            error: error.message,
          },
          { status: 502 },
        ),
      )
    })

    if (body && body.length > 0) {
      upstreamRequest.write(body)
    }

    upstreamRequest.end()
  })
}

export const GET = handleRequest
export const POST = handleRequest
export const PUT = handleRequest
export const PATCH = handleRequest
export const DELETE = handleRequest
export const OPTIONS = handleRequest
export const HEAD = handleRequest
