#!/usr/bin/env bash
set -euo pipefail

TRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$TRAIN_DIR/compose.training.yaml"
ENV_FILE="$TRAIN_DIR/.env.training"
PROJECT_NAME="bonasov1-training"
LIVE_ENV_FILE="/home/bonasoadmin/BONASOV1/backend/.env"

if [[ ! -f "$LIVE_ENV_FILE" ]]; then
  echo "Live backend env file not found: $LIVE_ENV_FILE" >&2
  exit 1
fi

LIVE_DB_URL="$(grep '^DATABASE_URL=' "$LIVE_ENV_FILE" | cut -d= -f2-)"
if [[ -z "$LIVE_DB_URL" ]]; then
  echo "DATABASE_URL missing in $LIVE_ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

echo "Starting training database container..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d training-db

echo "Waiting for training database readiness..."
for _ in $(seq 1 60); do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" exec -T training-db pg_isready -U "$TRAINING_DB_USER" -d "$TRAINING_DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "Resetting training database schema..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" exec -T training-db \
  psql -U "$TRAINING_DB_USER" -d "$TRAINING_DB_NAME" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "Cloning live database into training database (read-only source)..."
pg_dump --clean --if-exists --no-owner --no-privileges "$LIVE_DB_URL" | \
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" exec -T training-db \
  psql -U "$TRAINING_DB_USER" -d "$TRAINING_DB_NAME" -v ON_ERROR_STOP=1

# ---------------------------------------------------------------------------
# Anonymise respondent PII in the training clone.
#
# The training database is a structural copy of live so that demos and practice
# use realistic shapes/volumes — but it must NOT expose real respondents'
# identities. We pseudonymise direct identifiers while preserving demographics
# (gender, age via date_of_birth) so disaggregation still works. Staff login
# accounts (users_user) are intentionally left intact so trainers/trainees can
# sign in with their normal credentials.
# ---------------------------------------------------------------------------
echo "Anonymising respondent PII in the training clone..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" exec -T training-db \
  psql -U "$TRAINING_DB_USER" -d "$TRAINING_DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
UPDATE respondents_respondent
SET first_name = 'Trainee',
    last_name  = 'R' || id,
    unique_id  = 'TRAIN-' || id,
    phone      = '',
    email      = '',
    address    = '';
SQL

echo "Copying media/uploads snapshot to training volumes..."
rsync -a /home/bonasoadmin/BONASOV1/backend/uploads/ "$TRAIN_DIR/state/backend/uploads/"
rsync -a /home/bonasoadmin/BONASOV1/backend/media/ "$TRAIN_DIR/state/backend/media/"

echo "Starting training backend and frontend..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d --build training-backend training-frontend

echo "Training environment is up."
echo "Frontend (via nginx TLS): https://${TRAINING_PUBLIC_HOST}"
echo "Frontend (local-only): http://127.0.0.1:${TRAINING_FRONTEND_PORT}"
echo "Backend (local-only): http://127.0.0.1:${TRAINING_BACKEND_PORT}"
