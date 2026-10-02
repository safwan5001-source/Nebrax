import type { Page } from '@playwright/test';

/**
 * Supported Demo Mode setup for e2e (replaces the removed «دخول تجريبي» login button).
 *
 * Demo Mode is the localStorage flag + user that `lib/demo.ts#enableDemo` writes. Seeding it
 * through an init script is what the v3 specs have always done; it runs before every document
 * of the page, so a reload or a second navigation stays in Demo Mode. The values mirror
 * `DEMO_USER` in lib/demo.ts (owner, full permissions) — keep the two in sync.
 */
export async function seedDemoSession(page: Page, extra: Record<string, string> = {}) {
  await page.addInitScript((extraEntries) => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({
      id: 'demo-user', name: 'مستخدم المعاينة', email: 'demo@nibras.test',
      role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant',
    }));
    for (const [key, value] of Object.entries(extraEntries)) localStorage.setItem(key, value);
  }, extra);
}
