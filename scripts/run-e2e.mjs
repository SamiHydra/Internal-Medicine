import { rmSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const databasePath = path.join(repositoryRoot, 'backend', 'database', 'e2e.sqlite')
const authDirectory = path.join(repositoryRoot, 'tests', 'e2e', '.auth')

const result = spawnSync(
  process.execPath,
  [playwrightCli, 'test', ...process.argv.slice(2)],
  { cwd: repositoryRoot, stdio: 'inherit' },
)

let cleanupFailed = false

for (const target of [databasePath, authDirectory]) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (error) {
    cleanupFailed = true
    console.error(`Unable to remove E2E artifact ${target}:`, error)
  }
}

if (result.error) {
  throw result.error
}

process.exit(cleanupFailed ? 1 : (result.status ?? 1))
