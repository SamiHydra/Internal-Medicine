# Repo Guide

## Package Manager And Commands

- Package manager: `npm`
- Install: `npm install`
- Dev server: `npm run dev`
- Dev server on LAN: `npm run dev:host`
- Build: `npm run build`
- Lint: `npm run lint`
- Tests: `npm run test:run`
- Full validation: `npm run verify`

## Environment

- Copy `.env.local.example` to `.env.local` for local browser development.
- Required browser vars:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Optional script-only vars:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_DB_URL`
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser code or Cloudflare client bundles.

## Supabase Setup

- Apply migrations in `supabase/migrations/` in order.
- Seed with `supabase/seed.sql`.
- To create sample auth users after the project exists:
  - `npm run supabase:demo-users`

## Deployment

- Target platform: Cloudflare Pages
- Build command: `npm run build`
- Output directory: `dist`
- SPA routing fallback is handled by `public/_redirects`
- Pages config also exists in `wrangler.toml`
