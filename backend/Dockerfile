# syntax=docker/dockerfile:1.7

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=18000

WORKDIR /app

# PostgreSQL 18 client tools (pg_dump/pg_restore) so on-demand backup generation
# and supervised restore can run inside the container against the PG 18 server.
# Installed from the PGDG apt repo (Debian bookworm base) to match the server
# major version — Debian's own postgresql-client is too old to dump a v18 server.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --upgrade pip && \
    pip install -r requirements.txt

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 18000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
