import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for the Net Worth page at `/networth`.
 *
 * Two responsibilities:
 *   1. Read the hero totals (Net Worth, Total Assets, Total Liabilities) and
 *      individual asset rows so cross-module tests can assert balance-sheet
 *      impact (§4 NWRT-FC).
 *   2. Open the AssetFormModal via the "+ Add Asset" button — assets live
 *      on this page in current FinFlow; there is no separate /assets route.
 *
 * Liabilities (debts) have their own page at /debts; see DebtsPage.
 *
 * IMPORTANT: the totals are rendered through the Money component which
 * adaptively formats large values (k/m suffix at scale). For deterministic
 * assertions on small-household seeds the formatted text matches the raw
 * number, but tests that build very large numbers must read the underlying
 * attribute (e.g. `aria-label`) or compare numerically via `parseMoney()`.
 */
export class NetWorthPage {
  readonly page: Page;
  readonly addAssetButton: Locator;
  readonly netWorthHero: Locator;
  readonly totalAssetsRow: Locator;
  readonly totalLiabilitiesRow: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addAssetButton      = page.getByRole('button', { name: /add asset/i });
    // "Net Worth" appears as an uppercase mono-label above the hero figure.
    // The figure sits in the same card; assertions read its accessible text.
    this.netWorthHero        = page.locator('section', { hasText: /^Net Worth/i }).first();
    this.totalAssetsRow      = page.locator('text=Total Assets').locator('..');
    this.totalLiabilitiesRow = page.locator('text=Total Liabilities').locator('..');
  }

  async goto() {
    await this.page.goto('/networth');
    await this.page.waitForURL('**/networth');
  }

  /** Asset row located by name (the user-supplied label). */
  assetRow(name: string): Locator {
    // A name can appear more than once (the row and a linked account/summary); use the first visible.
    return this.page.getByText(name, { exact: false }).filter({ visible: true }).first();
  }

  async openAddAsset() {
    await this.addAssetButton.click();
  }

  /**
   * Read the numeric value rendered in a balance-sheet row. Strips currency
   * symbols, thousands separators, and the k/m suffix from `Money`. Returns
   * NaN on parse failure so the caller's expect() surfaces the real text.
   */
  async readAmount(rowLocator: Locator): Promise<number> {
    const text = (await rowLocator.innerText()).trim();
    return parseMoney(text);
  }

  /** "Total Liabilities" is only rendered once the household has a debt: none means 0. */
  async readTotalLiabilities(): Promise<number> {
    // count() does not wait: settle on Total Assets (always rendered) first, or a page
    // still loading reads as "no liabilities".
    await this.totalAssetsRow.first().waitFor();
    if (await this.page.getByText('Total Liabilities').count() === 0) return 0;
    return this.readAmount(this.totalLiabilitiesRow);
  }

  /** The "Liquid assets" ratio card ("Money you can reach" v10.38.1–v10.103; Aurora 4.0 TERM1). */
  liquidAssets(): Locator {
    return this.page.getByText('Liquid assets', { exact: true }).locator('..');
  }
}

/**
 * Parse a money string as rendered by the `Money` component into a plain
 * number. Handles "$1,234.56", "€12,000", "1.2k", "1.5m". Currency-agnostic.
 */
export function parseMoney(s: string): number {
  const match = s.match(/(-?\d[\d,]*(?:\.\d+)?)\s*([km])?/i);
  if (!match) return NaN;
  let n = parseFloat(match[1].replace(/,/g, ''));
  const suffix = match[2]?.toLowerCase();
  if (suffix === 'k') n *= 1_000;
  if (suffix === 'm') n *= 1_000_000;
  return n;
}
