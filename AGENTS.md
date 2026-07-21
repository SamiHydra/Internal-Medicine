# Repo Guide

This is a Vite + React + TypeScript SPA (repo root) backed by a Laravel API in `backend/`. Both run together for local development.

## Package Manager And Commands (frontend)

- Package manager: `npm`
- Install: `npm install`
- Dev server: `npm run dev`
- Dev server on LAN: `npm run dev:host`
- Build: `npm run build`
- Lint: `npm run lint`
- Tests: `npm run test:run`
- Full validation: `npm run verify`

## Backend (Laravel API)

- Location: `backend/`
- Serve: `cd backend && php artisan serve` (http://127.0.0.1:8000)
- Migrate: `php artisan migrate` (SQLite by default in local dev)
- Seed reference data: `php artisan db:seed`
- Create the first superadmin: `php artisan app:create-superadmin`
- Tests: `php artisan test`

## Environment

- Frontend: copy `.env.local.example` to `.env.local`. The only required browser var is `VITE_API_BASE_URL`. Locally it points at the Vite origin (`http://localhost:5173`) because `/api` and `/sanctum` are proxied to the Laravel backend (see `vite.config.ts`) - this keeps the SPA and API same-origin for Sanctum's SameSite cookie auth.
- Backend: copy `backend/.env.example` to `backend/.env` and run `php artisan key:generate`.
- Never commit real `.env` files; only `*.example` templates are tracked.

## Auth model

- Laravel Sanctum SPA cookie auth. The frontend calls `/sanctum/csrf-cookie`, then authenticated `/api/*` endpoints with credentials. Authorization is enforced server-side via permission middleware + policies (`backend/app/Policies`, `backend/app/Support/Authorization/Permissions.php`).

## Deployment

- Production target: one on-premises Ubuntu server on the hospital LAN. Nginx serves `dist/` and Laravel from the same HTTPS origin. The atomic release flow and host files live in `deploy/`.
- Build command: `npm run build`, output `dist`. In production `VITE_API_BASE_URL` is the same HTTPS application origin.
- `wrangler.toml` and `public/_redirects` are retained only for non-production preview builds.
