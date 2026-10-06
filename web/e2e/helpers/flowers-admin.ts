import { expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Horizon 2 — مساعدات التحقق البصري المشتركة لشاشات إدارة التاجر.
 * الخادم مُعترَض بحمولات تطابق عقد `commerce/workspace/*` الفعلي؛ لا بيانات تُخترع خارج العقد.
 */
export const BASE = 'http://127.0.0.1:3001';

export const STORE = {
  id: 's1',
  name: 'ورد الندى',
  sales_channel_id: 'ch1',
  is_active: true,
  preview_url: 'https://nada.example.test/',
  default_locale: 'ar',
  business_vertical: 'flowers_gifts',
  vertical_profile: { key: 'flowers_gifts', recommended_capabilities: [] },
};

export type Handler = (url: string, route: Route) => Promise<boolean | void> | boolean | void;

export async function seedAdmin(
  page: Page,
  locale: 'ar' | 'en',
  handler: Handler,
  opts: { permissions?: string[]; role?: string; dark?: boolean; stores?: unknown[] } = {},
) {
  await page.context().addCookies([{ name: 'locale', value: locale, url: BASE }]);
  if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
  const permissions = opts.permissions ?? ['*'];
  await page.addInitScript(
    ([perms, role]) => {
      localStorage.setItem('token', 'test-token');
      localStorage.setItem(
        'user',
        JSON.stringify({ id: 'u1', name: 'المالك', email: 'o@test', role, permissions: perms, tenant_id: 't1' }),
      );
    },
    [permissions, opts.role ?? 'owner'] as const,
  );
  // شارة أدوات التطوير في Next تغطي أسفل الشاشة وتعترض النقر؛ ليست جزءاً من المنتج.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none !important}';
      document.head.appendChild(style);
    });
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (/\/commerce\/workspace\/storefronts(\?|$)/.test(url) && route.request().method() === 'GET') {
      return route.fulfill({ json: { data: { stores: opts.stores ?? [STORE] } } });
    }
    const handled = await handler(url, route);
    if (handled === true) return;
    return route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
}

export async function assertNoOverflow(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw, `horizontal overflow ${o.sw} > ${o.cw}`).toBeLessThanOrEqual(o.cw + 1);
}

export async function evidenceDir(slice: string) {
  const dir = path.resolve(process.cwd(), 'test-results', slice);
  await mkdir(dir, { recursive: true });
  return dir;
}

export const VIEWPORTS = [
  [390, 844],
  [430, 932],
  [1024, 800],
  [1440, 960],
] as const;
