import type { Page } from '@playwright/test';
import { NetWorthPage } from './NetWorthPage';

/**
 * FinFlow has no standalone /assets route — asset CRUD lives on the Net
 * Worth page. `AssetsPage` is therefore a thin alias over `NetWorthPage`
 * that gives §8 ASSET-FC tests a name matching their domain.
 *
 * If a future release adds a dedicated /assets route, replace this with
 * a real POM; the import surface stays stable.
 */
export class AssetsPage extends NetWorthPage {
  constructor(page: Page) {
    super(page);
  }

  // Inherit goto(), openAddAsset(), assetRow(), readAmount() from NetWorthPage.
}
