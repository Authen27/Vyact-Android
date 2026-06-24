import { test, expect } from '../fixtures/app';

const GOOGLE_ROUTES = [
  { path: '/auth/sign-in', heading: 'Welcome back' },
  { path: '/auth/sign-up', heading: 'Create your account' },
  { path: '/auth/reset', heading: 'Reset your password' },
] as const;

test.describe('§14 AUTH-FC · Local-only auth routes', () => {
  test('AUTH-FC-010 · Continue with Google shows the coming-soon toast without navigating', async ({ page }) => {
    for (const route of GOOGLE_ROUTES) {
      await page.goto(route.path);
      await page.waitForURL(`**${route.path}`);
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();

      const button = page.getByRole('button', { name: /continue with google/i });
      await expect(button).toBeVisible();
      await button.click();

      await expect(page.getByText('Google sign-in coming soon — use email for now')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route.path.replace('/', '\\/')}$`));
    }
  });

  test('AUTH-FC-012 · reset page shows no-cloud guidance when Supabase is not configured', async ({ page }) => {
    await page.goto('/auth/reset');
    await page.waitForURL('**/auth/reset');

    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.getByText('Password reset needs cloud mode. You can still sign in below.')).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();

    const backToSignIn = page.getByRole('link', { name: /back to sign in/i });
    await expect(backToSignIn).toBeVisible();
    await backToSignIn.click();
    await page.waitForURL('**/auth/sign-in');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});