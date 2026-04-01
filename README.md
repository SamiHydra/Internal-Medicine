# Mesay Weekly Hospital Reporting Dashboard

Mesay is a Vite + React frontend that keeps the existing UI structure and visual design, but now expects a real Supabase backend for authentication, authorization, report persistence, notifications, audit logging, and settings.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, React Router, React Hook Form, Zod, Recharts
- Backend: Supabase Auth, Postgres, RLS, SQL functions, SQL views
- Package manager: `npm`
- Deployment target: Cloudflare Pages

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Create local env file

Copy `.env.local.example` to `.env.local` and fill in:

```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Get both values from:

1. Supabase Dashboard
2. Project Settings
3. API

If these are missing, the app still starts but shows a clear blocking configuration screen instead of using fake demo data.

### 3. Start the dev server

```bash
npm run dev
```

### 4. Validate the app

```bash
npm run verify
```

## Required Environment Variables

### Browser runtime variables

These are required for local development and Cloudflare Pages production deployment:

```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

### Script-only variables

These are optional unless you use the setup scripts or manual seeding commands:

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_DB_URL=postgresql://postgres:your-password@db.your-project-id.supabase.co:5432/postgres
```

Where to get them:

- `SUPABASE_URL`: same Supabase API settings page as the browser URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase Dashboard -> Project Settings -> API -> service role key
- `SUPABASE_DB_URL`: Supabase Dashboard -> Project Settings -> Database or Connection String

Important:

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser code
- Never put `SUPABASE_SERVICE_ROLE_KEY` into Cloudflare Pages public runtime variables
- Only `VITE_` variables are intended for the browser build

## Repo Layout

- `src/`: application UI and live Supabase client/provider code
- `supabase/migrations/202603290001_initial_schema.sql`: base schema, RLS, and views
- `supabase/migrations/202603300001_live_integration.sql`: live auth/profile bootstrap, RPCs, audit/notification logic, and security updates
- `supabase/seed.sql`: roles, templates, departments, field definitions, settings, and rolling reporting periods
- `scripts/create-demo-users.mjs`: creates sample Supabase Auth users and matching profiles for local/dev setup
- `.env.example`: all known env vars, including script-only ones
- `.env.local.example`: local browser-only env template
- `public/_redirects`: SPA routing for Cloudflare Pages
- `wrangler.toml`: Cloudflare Pages build output config

## Supabase Setup

### 1. Create the Supabase project

Create a project in Supabase, then collect:

- Project URL
- Anon key
- Service role key
- Optional database connection string if you want to run `psql` directly

### 2. Apply the database schema

If you use the Supabase CLI:

```bash
supabase db push
```

If you use the Supabase SQL editor instead, run these files in order:

1. `supabase/migrations/202603290001_initial_schema.sql`
2. `supabase/migrations/202603300001_live_integration.sql`

### 3. Seed the reference data

Using `psql`:

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

Or paste `supabase/seed.sql` into the Supabase SQL editor after the migrations.

### 4. Create demo and admin users for development

Set these shell variables first:

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Then run:

```bash
npm run supabase:demo-users
```

That script creates these sample users in Supabase Auth and ensures matching rows exist in `public.profiles`:

- `admin1@mesayhospital.demo`
- `mesay.gemechu@mesayhospital.demo`
- `hana.abera@mesayhospital.demo`
- `samuel.hailu@mesayhospital.demo`
- `ruth.mamo@mesayhospital.demo`

Shared sample password:

```text
Mesay2026!
```

### 5. Recommended Auth setting

The access-request page can create a nurse auth account and submit the request record. For the smoothest internal rollout, either:

- disable mandatory email confirmation in Supabase Auth, or
- keep your confirmation flow and expect new nurses to confirm before first sign-in

## Local Development

### Commands

```bash
npm install
npm run dev
npm run lint
npm run test:run
npm run build
```

Useful extras:

```bash
npm run dev:host
npm run verify
```

### What is locally runnable without secrets

- The Vite app starts
- The production build completes
- The app renders the existing UI
- Missing Supabase env values show a clear configuration message instead of silently using mock data

### What still requires your real Supabase project

- Real login
- Real access request submission
- Real admin approval and rejection
- Real report saves and submits
- Real lock and unlock mutations
- Real notifications and audit rows

## Cloudflare Pages Deployment

The repo already points to Cloudflare Pages, so that remains the deployment target.

### Why Cloudflare Pages

- The project is a static Vite SPA
- `_redirects` is already in place for deep-link routing
- No custom Node server is required
- The browser only needs public `VITE_` variables

### Build settings

- Build command: `npm run build`
- Output directory: `dist`

`wrangler.toml` already sets:

```toml
pages_build_output_dir = "./dist"
```

### Required Cloudflare Pages environment variables

Set these in Cloudflare Pages -> Settings -> Environment Variables:

```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Do not set `SUPABASE_SERVICE_ROLE_KEY` as a browser-exposed Pages variable.

### SPA routing

`public/_redirects` contains:

```text
/* /index.html 200
```

That keeps routes like `/admin`, `/nurse/reports`, and `/reports/:assignmentId/:periodId` working in production.

## Core Flow Status

### Wired in code

- Login and logout
- Session restore
- Protected routes
- Role-aware redirects
- Access request submit
- Admin approve and reject
- Save draft
- Submit report
- Edit submitted unlocked report
- Lock and unlock
- Notification reads
- Audit logging for unlocked submitted-report edits

### Requires your real Supabase project to verify at runtime

- Login with real users
- Access request inserts
- Approval creating real assignments
- Draft save writing `reports` and `report_field_values`
- Submit creating status history and notifications
- Edit-after-submit creating `audit_logs`
- Lock and unlock creating notifications and status transitions
- RLS behavior for nurse-only visibility versus admin visibility

## Verification In This Workspace

Run:

```bash
npm run lint
npm run test:run
npm run build
```

Verified from this workspace:

- `npm run lint`
- `npm run test:run`
- `npm run build`

`npm run dev` can also start locally without secrets, but the app will stop at the configuration screen until `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are provided.

## Secret Blockers

I still need these values from you before I can prove a live end-to-end run:

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

And if you want me to create demo users automatically:

```bash
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Without those values, I can make the repo fully ready, but I cannot honestly claim a live Supabase-backed runtime verification.
