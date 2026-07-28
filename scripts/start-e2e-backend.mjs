import { randomBytes } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendRoot = path.join(repositoryRoot, 'backend')
const databasePath = path.join(backendRoot, 'database', 'e2e.sqlite')
const authDirectory = path.join(repositoryRoot, 'tests', 'e2e', '.auth')

// This launcher owns one fixed, gitignored test database. Never accept a path
// from the caller: doing so could turn migrate:fresh into a destructive action.
rmSync(databasePath, { force: true })
rmSync(authDirectory, { recursive: true, force: true })
writeFileSync(databasePath, '')

const environment = {
  ...process.env,
  APP_ENV: 'local',
  APP_DEBUG: 'false',
  APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
  APP_URL: 'http://localhost:5173',
  DB_CONNECTION: 'sqlite',
  DB_DATABASE: databasePath,
  // This database is disposable and every account shares one known password, so
  // production-grade hashing only buys startup latency. At the seeded headcount
  // (180+ accounts) the default cost dominated the whole gate's startup budget.
  BCRYPT_ROUNDS: '4',
  // The gate tests behaviour, not scale: a fixture deep enough for trends is
  // plenty, and seeding a full year would push startup past the webServer
  // timeout. Perf runs opt into a bigger archive by exporting this themselves,
  // e.g. SEED_HISTORY_WEEKS=52 npm run test:e2e.
  SEED_HISTORY_WEEKS: process.env.SEED_HISTORY_WEEKS ?? '30',
  CACHE_STORE: 'database',
  SESSION_DRIVER: 'database',
  SESSION_DOMAIN: '',
  SESSION_SECURE_COOKIE: 'false',
  SESSION_COOKIE: 'mesay_e2e_session',
  QUEUE_CONNECTION: 'sync',
  MAIL_MAILER: 'array',
  BROADCAST_CONNECTION: 'log',
  SANCTUM_STATEFUL_DOMAINS: 'localhost:5173,127.0.0.1:5173',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
}

// Cached Laravel configuration takes precedence over environment overrides.
// Clear it before migrate:fresh so the fixed E2E database path cannot be
// bypassed by a developer's previously cached connection.
const configClear = spawnSync(
  'php',
  ['artisan', 'config:clear', '--no-interaction'],
  { cwd: backendRoot, env: environment, stdio: 'inherit' },
)

if (configClear.error || configClear.status !== 0) {
  rmSync(databasePath, { force: true })
  throw configClear.error ?? new Error(`Laravel config cleanup exited ${configClear.status}`)
}

const migration = spawnSync(
  'php',
  ['artisan', 'migrate:fresh', '--seed', '--force', '--no-interaction'],
  { cwd: backendRoot, env: environment, stdio: 'inherit' },
)

if (migration.error || migration.status !== 0) {
  rmSync(databasePath, { force: true })
  throw migration.error ?? new Error(`E2E database preparation exited ${migration.status}`)
}

const server = spawn(
  'php',
  ['artisan', 'serve', '--host=127.0.0.1', '--port=8000', '--no-interaction'],
  { cwd: backendRoot, env: environment, stdio: 'inherit' },
)

let shuttingDown = false

function removeDatabase() {
  if (existsSync(databasePath)) {
    rmSync(databasePath, { force: true })
  }

  rmSync(authDirectory, { recursive: true, force: true })
}

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  if (!server.killed) {
    server.kill(signal)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

server.on('error', (error) => {
  removeDatabase()
  throw error
})

server.on('exit', (code) => {
  removeDatabase()
  process.exit(code ?? 0)
})
