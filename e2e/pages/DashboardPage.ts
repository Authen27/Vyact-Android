import type { Page, Locator } from '@playwright/test';

/** Page Object for the Dashboard (default landing route in local mode). */
export class DashboardPage {
  readonly page: Page;
  /** Sidebar logo link — has a hardcoded, non-translated aria-label, so it is
   *  a stable anchor for "the app shell rendered". */
  readonly logoLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.logoLink = page.getByLabel('Vyact — go to dashboard');
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForURL('**/dashboard');
  }
}
