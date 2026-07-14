# syntax=docker/dockerfile:1.7

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=18000

WORKDIR /app

# PostgreSQL 18 client tools (pg_dump/pg_restore) so on-demand backup generation
# and supervised restore can run inside the container against the PG 18 server.
# Installed from the PGDG apt repo (Debian trixie base) to match the server major
# version — Debian's own postgresql-client is too old to dump a v18 server.
# Hardened against transient apt.postgresql.org / CDN blips: apt retries downloads,
# the key fetch retries, and the pgdg install is retried a few times so a momentary
# network failure doesn't fail the whole build. The final pg_dump --version asserts
# the client is actually present (fail loudly rather than ship without it).
RUN set -eux; \
    echo 'Acquire::Retries "8"; Acquire::http::Timeout "30"; Acquire::https::Timeout "30";' \
        > /etc/apt/apt.conf.d/80-retries; \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg; \
    install -d /usr/share/postgresql-common/pgdg; \
    for i in 1 2 3 4 5; do \
        curl -fsSL --retry 8 --retry-all-errors --retry-delay 5 --connect-timeout 30 \
            -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
            https://www.postgresql.org/media/keys/ACCC4CF8.asc && break || { echo "key fetch retry $i"; sleep 8; }; \
    done; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    for i in 1 2 3 4 5; do \
        apt-get update && apt-get install -y --no-install-recommends --fix-missing postgresql-client-18 && break \
            || { echo "pgdg install retry $i"; sleep 10; }; \
    done; \
    pg_dump --version; \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --upgrade pip && \
    pip install -r requirements.txt

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 18000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
