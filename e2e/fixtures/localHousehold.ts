import type { Page } from '@playwright/test';
import type { SeedData } from './seed';

export async function seedLocalHousehold(page: Page, data: SeedData) {
  await page.route('**/__local-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local fixture</title>' }));
  await page.goto('/__local-fixture');
  await page.evaluate(async seed => {
    localStorage.setItem('vt_active_profile', 'local');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('vyact', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('kv', 'readwrite');
      const store = transaction.objectStore('kv');
      const values = { ...seed, recurring: seed.recurringSchedules,
        profiles_list: [{ id: 'local', name: 'Example household', type: 'family', baseCurrency: 'USD', createdAt: '2026-01-01T00:00:00Z' }] };
      for (const [key, value] of Object.entries(values)) if (value !== undefined) store.put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, data);
  await page.unroute('**/__local-fixture');
}