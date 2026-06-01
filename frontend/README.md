# BONASO Data Portal - Frontend

Canonical URL policy: use `https://sesigo.org.bw` for all user links and communications.
Do not distribute `www.sesigo.org.bw`.

## Quickstart
### 1. Install dependencies
```bash
cd /home/bonasoadmin/BONASOV1/frontend
npm install
```

Windows (PowerShell):
```powershell
cd C:\Users\dekok\OneDrive\Desktop\Bonasov1\frontend
npm install
```

### 2. Configure environment
Create `frontend/.env.local` with:
```
NEXT_PUBLIC_API_URL=https://sesigo.org.bw/api
```

Alternative supported keys:
- `BACKEND_API_URL` for the Next.js `/api/*` rewrite target
- `NEXT_PUBLIC_API_BASE_URL` as a legacy alias for `NEXT_PUBLIC_API_URL`

### 3. Start development server
```bash
npm run dev
```
Open `https://sesigo.org.bw`.

### Server quickstart (this VM)
```bash
cd /home/bonasoadmin/BONASOV1/frontend
npm run build
PORT=13001 npm run start
```
Use `PORT=13001` when `13000` is already used by Docker (`frontend-frontend-1`).

## Docker
This repo can now run as a Dockerized frontend.

By default, `compose.yaml` builds the frontend with:
```
NEXT_PUBLIC_API_URL=https://sesigo.org.bw/api
BACKEND_API_URL=https://sesigo.org.bw/api
```

Then start it with:
```bash
docker compose up --build
```

That setup targets the canonical public API endpoint at `https://sesigo.org.bw/api`.

If you need to override those Docker values, use `DOCKER_NEXT_PUBLIC_API_URL` and
`DOCKER_BACKEND_API_URL` instead of your normal local `.env.local` keys.

### Full stack note
PostgreSQL belongs to the Django backend, not this Next.js frontend. This repo includes
`compose.full-stack.example.yaml` as a reference for a future frontend + backend + postgres stack,
but it is not runnable until you provide the backend image or backend source tree.
The example file is production-oriented and expects explicit secure environment values.

### Full stack on this machine
If your Django backend source is at `C:/Projects/django_backend`, you can run the whole stack with:
```bash
docker compose -f compose.full-stack.local.yaml up --build
```

That file starts:
- frontend on `https://sesigo.org.bw`
- Django API on `https://sesigo.org.bw/api`
- PostgreSQL on `postgres:5432`

It uses:
- `NEXT_PUBLIC_API_URL=https://sesigo.org.bw/api` in the browser
- `BACKEND_API_URL=https://sesigo.org.bw/api` inside the frontend container
- `DATABASE_URL=postgres://bonaso:bonaso@postgres:5432/bonaso` for Django

You can override the backend source path with:
```powershell
$env:DJANGO_BACKEND_PATH="C:/Projects/django_backend"
docker compose -f compose.full-stack.local.yaml up --build
```

If port `13000` is already in use, override the frontend port:
```powershell
$env:FRONTEND_PORT="13001"
docker compose -f compose.full-stack.local.yaml up --build
```

This local compose file now builds a real Django image from `C:/Projects/django_backend`.
The backend container runs migrations and `collectstatic` on startup, then serves the API with Gunicorn.
First build is slower because Python dependencies are installed into the image.
`compose.full-stack.local.yaml` is for local development only; it intentionally keeps `DEBUG=True`
and disables HTTPS-only cookie settings for bootstrap environments.

## User Documentation
- End-user guide: `docs/user-manual.md`

## Architecture
The frontend is a Next.js App Router project:
- `app/` routes for dashboard modules.
- `components/` reusable UI.
- `lib/api/` API client + services.
- `lib/hooks/` SWR hooks.
- `styles/` global styles.

## UI
### Dashboard
Overview stats, active projects, alerts.

### Organizations
List coordinators with sub-grantee dropdowns. Organization detail shows indicators and users.
Layouts are responsive with stacked action buttons on small screens.

### Projects
Project detail shows organizations, deadlines, and indicator-based tasks.
Create dialogs and forms are responsive.

### Indicators
Manage indicator definitions and view where assigned.
Summary stats and create dialogs are responsive.
Categories: HIV Prevention, Non-Communicable Diseases, Events.

### Aggregates
Add aggregate entries, matrix view (KP x Sex x Age), import/export.
Tables are horizontally scrollable on small screens.

### Reports & Analysis
Indicator trend dashboards with multi-indicator charts, chart type selection, and saved charts.
Reports forms, filters, and dialogs are responsive.

### Respondents & Interactions
Respondent profile and interaction tracking. Filters/actions stack on small screens.

### Events
Event tracking with indicators and participants. Create dialogs are responsive.
## API
All data is read/write via the Django backend at `NEXT_PUBLIC_API_URL`.
Services live in `lib/api/services/` and hooks in `lib/hooks/use-api.ts`.

## Data Cleanup
To purge uploaded aggregate/report data from the backend:
```bash
$env:BONASO_ACCESS_TOKEN="your-jwt-access-token"
npm run purge:data -- --dry-run
npm run purge:data
```

Optional scope:
```bash
npm run purge:data -- --types=aggregates,reports,scheduled
```

## Data Model
The frontend mirrors backend entities: Organization, Project, Indicator, Aggregate, User, etc.
Relations are resolved client-side using IDs from the API.

## Deployment
1. Set production API URL:
```
NEXT_PUBLIC_API_URL=https://sesigo.org.bw/api
```
2. Build:
```bash
npm run build
```
3. Start:
```bash
npm run start
```

`npm run build` now validates environment configuration and runs lint before the production build.

If you deploy in Docker behind the Next.js rewrite proxy, prefer:
```
NEXT_PUBLIC_API_URL=https://sesigo.org.bw/api
BACKEND_API_URL=https://sesigo.org.bw/api
```

`NEXT_PUBLIC_*` values are baked into the Next.js build, so rebuild the image when those change.

## Troubleshooting
- **401 errors**: re-authenticate; token expired.
- **CORS issues**: add frontend origin to backend `CORS_ALLOWED_ORIGINS`.
- **API not reachable**: confirm `NEXT_PUBLIC_API_URL` and backend running.
- **`npm ERR! enoent Could not read package.json`**: run npm from the project folder: `cd /home/bonasoadmin/BONASOV1/frontend`.
- **`EADDRINUSE: address already in use :::13000`**: either start on another port (`PORT=13001 npm run start`) or stop the Docker frontend first.

## Offline Mode (PWA)
The frontend now supports installable offline usage with a service worker.

### What works offline
- Cached pages and static assets.
- Previously requested `GET /api/*` responses from cache.
- Offline fallback screen at `/offline/` when navigation data is unavailable.
- `POST/PUT/PATCH/DELETE` requests are queued locally and replayed when connectivity returns.
- Sync audit log (queued/synced/dropped/failed) is stored locally and viewable from the sync widget.

### What does not work offline
- Login, token refresh, and password/auth mutations.
- First-time API `GET` requests that were never loaded before.

### How to validate
1. Build and start production:
```bash
npm run build
npm run start
```
2. Open the app in a browser and navigate through pages to warm caches.
3. Disable network in browser devtools and create/edit/delete a record.
4. Confirm the pending-sync badge increases.
5. Re-enable network and confirm queued mutations are replayed automatically.

### Development mode note
Service worker registration is disabled by default in `npm run dev`.
Set `NEXT_PUBLIC_ENABLE_SW=true` if you need to test service worker behavior in development.

## Android App (Play Store)
This project is configured with Capacitor for Android packaging.

### Commands
```bash
npm run mobile:doctor
npm run mobile:sync
npm run mobile:open:android
```

To point the Android app at a deployed frontend, set `CAP_SERVER_URL` before syncing.
If unset, the Android app defaults to `https://sesigo.org.bw`.

Bash:
```bash
export CAP_SERVER_URL="https://sesigo.org.bw"
npm run mobile:sync
```

PowerShell:
```powershell
$env:CAP_SERVER_URL="https://sesigo.org.bw"
npm run mobile:sync
```

Full Play Store checklist is in `docs/playstore-android.md`.

### Android offline behavior
- First app launch should be online to warm caches.
- After that, previously visited screens and cached API `GET` responses work offline.
- Mutations are queued locally and replayed when the device reconnects.

