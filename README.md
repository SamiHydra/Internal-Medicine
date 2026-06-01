# St Paul Weekly Hospital Reporting Dashboard

A Vite + React frontend for St Paul Internal Medicine weekly reporting, backed by a Laravel API for authentication, authorization, report persistence, notifications, audit logging, and settings.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, React Router, React Hook Form, Zod, Recharts
- Backend: Laravel (PHP), Sanctum SPA cookie auth, Eloquent ORM, policy-based authorization
- Database: SQLite for local dev; MariaDB/MySQL for staging/production
- Package managers: `npm` (frontend), Composer (backend)
- Deployment target: Cloudflare Pages (frontend) + a Laravel host (backend)

## Architecture

The browser SPA talks only to the Laravel API. Authentication uses Sanctum's SPA cookie flow: the client requests `/sanctum/csrf-cookie`, then calls `/api/*` endpoints with credentials. All authorization is enforced server-side via permission middleware and policies (`backend/app/Policies`, `backend/app/Support/Authorization/Permissions.php`) — the frontend role checks are UX only.

In local development, `vite.config.ts` proxies `/api` and `/sanctum` to the Laravel backend so the SPA and API are same-origin. This is required for Sanctum's `SameSite` session/XSRF cookies (using `localhost` for the app and `127.0.0.1` for the API directly would be treated as cross-site and fail with a CSRF error).

## Quick Start

### 1. Backend (Laravel API)

```bash
cd backend
cp .env.example .env
php artisan key:generate
php artisan migrate        # SQLite by default; zero-install for local dev
php artisan db:seed        # roles, templates, departments, field definitions, periods
php artisan app:create-superadmin   # create the first login
php artisan serve          # http://127.0.0.1:8000
```

### 2. Frontend (Vite SPA)

```bash
npm install
cp .env.local.example .env.local   # VITE_API_BASE_URL points at the Vite origin (proxy)
npm run dev                         # http://localhost:5173
```

Open http://localhost:5173 and sign in with the superadmin you created.

### 3. Validate

```bash
npm run verify                 # frontend: lint + tests + build
cd backend && php artisan test # backend test suite
```

## Environment Variables

### Frontend (browser, `VITE_`-prefixed)

Only `VITE_API_BASE_URL` is required. Locally it is the Vite origin (`http://localhost:5173`) because requests are proxied to Laravel. In production set it to the real API origin. Optional `VITE_REVERB_*` vars configure realtime (Laravel Reverb) if enabled. See `.env.local.example`.

### Backend (Laravel, `backend/.env`)

See `backend/.env.example`. Key settings: `APP_KEY` (via `php artisan key:generate`), `DB_CONNECTION` (sqlite locally, mariadb/mysql for prod), `SANCTUM_STATEFUL_DOMAINS` and `CORS_ALLOWED_ORIGINS` (must list every origin the browser uses), and `APP_DEBUG=false` for any non-local environment.

Real `.env` files are never committed — only `*.example` templates are tracked.

## Repo Layout

- `src/` — application UI and the live Laravel API client (`src/lib/api/`) + data provider (`src/context/app-data-context.tsx`)
- `src/data/selectors.ts` — client-side dashboard/report aggregation
- `backend/` — Laravel API (controllers, models, policies, services, migrations, seeders)
- `public/_redirects` — SPA routing for Cloudflare Pages
- `wrangler.toml` — Cloudflare Pages build output config
- `docs/migration/` — historical migration notes (the app was migrated from Supabase to Laravel)

## Local Commands

```bash
npm install
npm run dev          # Vite dev server
npm run dev:host     # expose on LAN
npm run lint
npm run test:run
npm run build
npm run verify       # lint + test:run + build
```

Backend:

```bash
cd backend
php artisan serve
php artisan migrate
php artisan db:seed
php artisan test
php artisan app:create-superadmin
```

## Cloudflare Pages Deployment (frontend)

- Build command: `npm run build`
- Output directory: `dist` (set in `wrangler.toml` via `pages_build_output_dir`)
- Set `VITE_API_BASE_URL` to the production API origin in Pages → Settings → Environment Variables.
- `public/_redirects` (`/* /index.html 200`) keeps deep links like `/admin` and `/reports/:assignmentId/:periodId` working.

Deploy the Laravel backend (`backend/`) to a PHP host separately, configure its database and `SANCTUM_STATEFUL_DOMAINS`/`CORS_ALLOWED_ORIGINS` for the production frontend origin, and ensure `APP_DEBUG=false`.

## Core Flows

Login/logout, session restore, protected + role-aware routes, access requests, admin approve/reject, draft save, submit, edit-after-submit (audit-logged), lock/unlock, notifications, analytics, and CSV export — all backed by the Laravel API with server-side authorization.
