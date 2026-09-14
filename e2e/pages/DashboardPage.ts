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
    // "/" now renders the public Landing page (vyact.app domain cutover), so
    // this helper navigates straight to "/dashboard" rather than relying on a
    // redirect that no longer happens. Direct navigation resolves `waitForURL`
    // faster than the old client-side redirect did (which gave the SPA extra
    // render time before the URL settled), so also wait for the shell itself.
    await this.page.goto('/dashboard');
    await this.page.waitForURL('**/dashboard');
    await this.logoLink.waitFor({ state: 'visible' });
  }
}
