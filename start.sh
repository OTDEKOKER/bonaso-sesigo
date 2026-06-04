#!/bin/bash

# ─────────────────────────────────────────────
#  BONASO Dev Start Script
#  Starts the Django backend and Next.js frontend
#  for local development.
#
#  Usage: bash start.sh
# ─────────────────────────────────────────────

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo -e "${BLUE}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║       BONASO Data Portal             ║"
echo "  ║       Local Dev Environment          ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# ─── 1. CHECK REQUIRED TOOLS ───────────────────

echo -e "${YELLOW}[1/5] Checking required tools...${NC}"

if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ Python3 not found. Install it and re-run.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Python3 found: $(python3 --version)${NC}"

if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found. Install it and re-run.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js found: $(node --version)${NC}"

if ! command -v npm &>/dev/null; then
  echo -e "${RED}✗ npm not found. Install it and re-run.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ npm found: $(npm --version)${NC}"

# ─── 2. CHECK ENV FILES ────────────────────────

echo ""
echo -e "${YELLOW}[2/5] Checking environment files...${NC}"

if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo -e "${RED}✗ Backend .env not found at backend/.env${NC}"
  echo -e "${RED}  Create it before running this script.${NC}"
  echo -e "${RED}  Minimum required variables:${NC}"
  echo -e "${RED}    DJANGO_SECRET_KEY=your-secret-key${NC}"
  echo -e "${RED}    DATABASE_URL=sqlite:///db.sqlite3${NC}"
  echo -e "${RED}    DEBUG=True${NC}"
  echo -e "${RED}    DB_SSL_REQUIRE=False${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Backend .env found${NC}"

if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
  echo -e "${YELLOW}⚠ Frontend .env.local not found. Creating a default one...${NC}"
  cat > "$FRONTEND_DIR/.env.local" <<EOF
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_API_BASE_URL=/api
BACKEND_API_URL=http://localhost:8000/api
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ENV=development
EOF
  echo -e "${GREEN}✓ Frontend .env.local created${NC}"
else
  echo -e "${GREEN}✓ Frontend .env.local found${NC}"
fi

# ─── 3. BACKEND SETUP ─────────────────────────

echo ""
echo -e "${YELLOW}[3/5] Setting up backend...${NC}"

cd "$BACKEND_DIR"

if [ ! -d "venv" ]; then
  echo "  Creating virtual environment..."
  python3 -m venv venv
  echo -e "${GREEN}✓ Virtual environment created${NC}"
else
  echo -e "${GREEN}✓ Virtual environment already exists${NC}"
fi

echo "  Installing backend dependencies..."
./venv/bin/pip install -r requirements.txt -q
echo -e "${GREEN}✓ Backend dependencies installed${NC}"

echo "  Running migrations..."
./venv/bin/python manage.py migrate --run-syncdb 2>&1
echo -e "${GREEN}✓ Migrations done${NC}"

# ─── 4. FRONTEND SETUP ────────────────────────

echo ""
echo -e "${YELLOW}[4/5] Setting up frontend...${NC}"

cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
  echo "  Installing frontend dependencies (this may take a moment)..."
  npm install
  echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
else
  echo -e "${GREEN}✓ Frontend dependencies already installed${NC}"
fi

# ─── 5. START BOTH SERVERS ────────────────────

echo ""
echo -e "${YELLOW}[5/5] Starting servers...${NC}"
echo ""
echo -e "${GREEN}  Backend  → http://localhost:8000${NC}"
echo -e "${GREEN}  Frontend → http://localhost:3000${NC}"
echo ""
echo -e "${YELLOW}  Press Ctrl+C to stop both servers${NC}"
echo ""

# Trap Ctrl+C to kill both servers cleanly
trap 'echo -e "\n${RED}Shutting down servers...${NC}"; kill 0' SIGINT

# Start backend
cd "$BACKEND_DIR"
./venv/bin/python manage.py runserver 0.0.0.0:8000 &
BACKEND_PID=$!

# Small delay so backend starts first
sleep 2

# Start frontend
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

# Wait for both
wait $BACKEND_PID $FRONTEND_PID
