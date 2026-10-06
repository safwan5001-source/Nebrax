import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { auditPage } from './helpers/a11y-audit';
import { assertNoOverflow, evidenceDir, productPageHandler, seedAdmin } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-14 — مراجعة جودة موحّدة عبر كل شاشات إدارة «الورد والهدايا»: عدم الفيضان الأفقي، وبنية الوصول
 * (تسميات/حوارات/مراجع aria/معرّفات/عناوين/أهداف اللمس)، بالعربية والإنجليزية، جوالاً وحاسوباً، فاتحاً وداكناً.
 * الخادم مُعترَض بحمولات العقد الفعلي (حالة «مأهولة» لتظهر كل العناصر).
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-14-ux-audit');
});

const KEYS = ['occasions', 'recipients', 'gift_message', 'personalization', 'add_ons', 'delivery_scheduling', 'same_day_delivery', 'structured_content', 'vertical_sections'];

const handler = productPageHandler(async (url: string, route: Route) => {
  const json = (body: unknown) => route.fulfill({ json: body }).then(() => true);
  if (url.endsWith('/vertical-setup/starters')) return json({ data: { starters: { would_create: 0, facets: [] } } });
  if (url.endsWith('/vertical-setup')) return json({ data: { setup: { vertical: 'flowers_gifts', items: KEYS.map((key, i) => ({ key, available: true, state: i % 2 === 0 ? 'configured' : 'not_configured', count: i % 2 === 0 ? 3 : 0, manage_in: 'x' })) } } });
  if (url.endsWith('/gift-settings')) return json({ data: { gift_settings: { enabled: true, message_max_length: 250, allow_hide_sender: true, recipient_phone_required: false } } });
  if (url.endsWith('/delivery-schedule')) {
    return json({ data: {
      settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 90, cutoff_time: '18:00', max_days_ahead: 30 },
      slots: [
        { id: 'a', method: 'delivery', label: 'صباحاً', label_en: 'Morning', start_time: '09:00', end_time: '12:00', weekdays: [0, 1, 2], capacity: 20, shipping_zone_id: null, sort_order: 0, is_active: true },
        { id: 'b', method: 'pickup', label: 'مساءً', label_en: null, start_time: '16:00', end_time: '20:00', weekdays: null, capacity: null, shipping_zone_id: null, sort_order: 1, is_active: false },
      ],
      blocked_dates: [{ date: '2027-02-14', method: 'all', reason: 'عطلة' }],
    } });
  }
  if (url.includes('/shipping-zones')) return json({ data: [{ id: 'z1', name: 'الدمام', is_active: true }] });
  if (url.endsWith('/fulfillment')) return json({ data: { fulfillment: { warehouse: { id: 'w1', code: '00001', name: 'المخزن الرئيسي', city: 'الدمام', is_active: true } }, warehouses: [{ id: 'w1', code: '00001', name: 'المخزن الرئيسي', city: 'الدمام', is_active: true }, { id: 'w2', code: '00002', name: 'مخزن الخبر', city: 'الخبر', is_active: true }] } });
  if (url.includes('/products/p1/preparation')) return json({ data: { preparation_minutes: 180 } });
  if (url.includes('/products/p1/personalization')) return json({ data: { fields: [{ key: 'card-name', type: 'text', label: 'الاسم على البطاقة', label_en: null, help_text: null, is_required: true, max_length: 20, is_active: true, options: [] }, { key: 'ribbon', type: 'select', label: 'لون الشريط', label_en: null, help_text: null, is_required: false, max_length: null, is_active: true, options: [{ value_key: 'red', label: 'أحمر', label_en: null, is_active: true }] }] } });
  if (url.includes('/products/p1/addons')) return json({ data: { addons: [{ addon_product_id: 'a', addon_variant_id: null, name: 'شوكولاتة بلجيكية', name_en: null, sku: 'CHOC', product_is_active: true, max_quantity: 2, is_active: true }] } });
  if (url.includes('/products/p1/content')) return json({ data: { blocks: [{ block_type: 'composition', body: '٢٤ وردة', body_en: null, is_active: true }] } });
  if (/\/api\/products\/a(\?|$)/.test(url)) return json({ data: { id: 'a', name: 'شوكولاتة بلجيكية', sku: 'CHOC', is_active: true, sale_price: '35.00', variant_state: 'simple' } });

  return false;
});

type Screen = { name: string; url: string; ready: string; open?: (page: Page) => Promise<void> };

const SCREENS: Screen[] = [
  { name: 'setup-center', url: '/commerce', ready: '[data-setup-center]' },
  { name: 'onboarding', url: '/commerce/onboarding?step=delivery_scheduling', ready: '[data-onboarding-step]' },
  { name: 'gifting', url: '/commerce/gifting', ready: '[data-gift-policy]' },
  { name: 'delivery-rules', url: '/commerce/delivery?tab=rules', ready: '[role="tablist"]' },
  { name: 'delivery-windows', url: '/commerce/delivery?tab=windows', ready: '[role="tablist"]' },
  { name: 'delivery-blocked', url: '/commerce/delivery?tab=blocked', ready: '[role="tablist"]' },
  { name: 'delivery-fulfilment', url: '/commerce/delivery?tab=fulfilment', ready: '[role="tablist"]' },
  { name: 'product-preparation', url: '/products/p1?tab=gifting&section=preparation', ready: '[data-product-gifting]' },
  { name: 'product-personalization', url: '/products/p1?tab=gifting&section=personalization', ready: '[data-personalization-section]' },
  { name: 'product-addons', url: '/products/p1?tab=gifting&section=addons', ready: '[data-addons-section]' },
  { name: 'product-content', url: '/products/p1?tab=gifting&section=content', ready: '[data-content-section]' },
];

test.describe('FLOWERS-H2-14 — cross-surface UX audit', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const screen of SCREENS) {
    for (const [locale, scheme, width, height] of [
      ['ar', 'light', 390, 844],
      ['en', 'light', 1440, 960],
      ['ar', 'dark', 1024, 800],
    ] as const) {
      test(`${screen.name} — ${locale} ${scheme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedAdmin(page, locale, handler, { dark: scheme === 'dark' });
        await page.goto(screen.url);
        await expect(page.locator(screen.ready).first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        await assertNoOverflow(page);
        const findings = await auditPage(page);
        await page.screenshot({ path: path.join(dir, `${screen.name}-${locale}-${scheme}-${width}.png`), fullPage: true });
        expect(findings, JSON.stringify(findings, null, 1)).toEqual([]);
      });
    }
  }

  const DIALOGS = [
    { name: 'slot-dialog', url: '/commerce/delivery?tab=windows', ready: '[data-windows-panel]', add: { ar: 'إضافة فترة', en: 'Add window' }, form: '[data-slot-form]' },
    { name: 'personalization-dialog', url: '/products/p1?tab=gifting&section=personalization', ready: '[data-personalization-section]', add: { ar: 'إضافة مُدخَل', en: 'Add input' }, form: '[data-personalization-form]' },
  ] as const;

  for (const dialog of DIALOGS) {
    for (const [locale, width, height] of [['ar', 390, 844], ['en', 1440, 960]] as const) {
      test(`${dialog.name} — ${locale} ${width}: focus enters, stays inside, returns on Escape; audit clean`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedAdmin(page, locale, handler);
        await page.goto(dialog.url);
        await expect(page.locator(dialog.ready)).toBeVisible();
        const opener = page.getByRole('button', { name: dialog.add[locale] }).first();
        await opener.focus();
        await opener.click();
        const root = page.getByRole('dialog');
        await expect(root).toBeVisible();
        // التركيز داخل الحوار فوراً، لا خلف الطبقة.
        await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
        for (let i = 0; i < 40; i += 1) {
          await page.keyboard.press('Tab');
          expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), `Tab ${i} escaped the dialog`).toBe(true);
        }
        await assertNoOverflow(page);
        const findings = await auditPage(page);
        await page.screenshot({ path: path.join(dir, `${dialog.name}-${locale}-${width}.png`) });
        expect(findings, JSON.stringify(findings, null, 1)).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(root).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe(dialog.add[locale]);
      });
    }
  }
});
