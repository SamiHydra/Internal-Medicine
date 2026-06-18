import { test as setup, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNTS, type Role } from './helpers/accounts'
import { authFile, uiLogin } from './helpers/auth'

const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth')

setup.beforeAll(() => {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
})

const roles: Role[] = ['superadmin', 'nurse', 'resident', 'consultant']

for (const role of roles) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await uiLogin(page, role)
    // Land on the role's home shell, confirming a real authenticated session.
    await expect(page).toHaveURL(new RegExp(ACCOUNTS[role].landing.replace(/\//g, '\\/')))
    await page.context().storageState({ path: authFile(role) })
  })
}
