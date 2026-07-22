import type { Page } from '@playwright/test'

export class LoginPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto('/login')
  }

  async submit(identifier: string, password: string) {
    await this.page.locator('#identifier').fill(identifier)
    await this.page.locator('#password').fill(password)
    await this.page.getByRole('button', { name: /sign in to reporting portal/i }).click()
  }
}
