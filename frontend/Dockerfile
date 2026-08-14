# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=https://sesigo.org.bw/api
ARG BACKEND_API_URL=https://sesigo.org.bw/api
# Content-Security-Policy (audit S1). Next bakes headers() at build time, so the
# policy must be present here. Empty by default → no CSP header emitted.
ARG CONTENT_SECURITY_POLICY=
ARG CONTENT_SECURITY_POLICY_REPORT_ONLY=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV BACKEND_API_URL=$BACKEND_API_URL
ENV CONTENT_SECURITY_POLICY=$CONTENT_SECURITY_POLICY
ENV CONTENT_SECURITY_POLICY_REPORT_ONLY=$CONTENT_SECURITY_POLICY_REPORT_ONLY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Cap the build heap so a memory spike fails THIS build cleanly rather than
# letting the host OOM-killer take down a live container on the RAM-constrained
# host (audit O1). Tune up if the build legitimately needs more headroom.
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=13000
ENV HOSTNAME=0.0.0.0
ARG NEXT_PUBLIC_API_URL=https://sesigo.org.bw/api
ARG BACKEND_API_URL=https://sesigo.org.bw/api
ARG CONTENT_SECURITY_POLICY=
ARG CONTENT_SECURITY_POLICY_REPORT_ONLY=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV BACKEND_API_URL=$BACKEND_API_URL
ENV CONTENT_SECURITY_POLICY=$CONTENT_SECURITY_POLICY
ENV CONTENT_SECURITY_POLICY_REPORT_ONLY=$CONTENT_SECURITY_POLICY_REPORT_ONLY
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs
EXPOSE 13000
CMD ["npm", "run", "start"]
