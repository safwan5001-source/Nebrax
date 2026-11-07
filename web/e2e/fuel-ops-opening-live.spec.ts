import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * PR-2 — دورة الرصيد الافتتاحي **كاملة على خادم Laravel حقيقي** (لا اعتراض): منشأة تجريبية جديدة بعد التسجيل ← بطاقة الدخول ← كميات ← تكلفة وحساب ← مسودة ومعاينة ←
 * اعتماد من **مستخدم ثانٍ** (فصل المعتمِد مفعَّل افتراضياً للمحطات الجديدة) ← التحقق من الأثر في الخادم (مستند، قيد، ميزان المراجعة) ← إعادة فتح الشاشة. يُشغَّل يدوياً فقط (يحتاج خادماً وقاعدة مؤقتة):
 *   OPENING_E2E_REGISTER=/path/register.json OPENING_E2E_APPROVER=/path/approver.json VQA_OUT=/tmp/live PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 \
 *   npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-opening-live.spec.ts
 * الواجهة مبنيّة بـ NEXT_PUBLIC_API_URL الافتراضي http://localhost:8000/api. لا يمسّ أي بيئة حية.
 */
const REGISTER = process.env.OPENING_E2E_REGISTER;
const APPROVER = process.env.OPENING_E2E_APPROVER;
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
const API = 'http://localhost:8000/api';
test.skip(!REGISTER || !APPROVER || !OUT, 'OPENING_E2E_REGISTER, OPENING_E2E_APPROVER and VQA_OUT are required');

async function shot(page: Page, name: string) {
  const file = join(OUT!, `${name}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test('beta owner: manage hub → wizard → approve → server state', async ({ page, request }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { token, user } = JSON.parse(require('node:fs').readFileSync(REGISTER!, 'utf8'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.context().addCookies([{ name: 'locale', value: 'en', url: baseUrl }]);
  await page.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', u); localStorage.setItem('theme', 'light'); }, [token, JSON.stringify(user)] as const);
  const writes: string[] = [];
  page.on('request', (r) => { if (r.url().startsWith(API) && r.method() !== 'GET' && r.method() !== 'OPTIONS') writes.push(`${r.method()} ${new URL(r.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}')}`); });

  // الدخول من «الإدارة» (البوابة مفتوحة افتراضياً لـ Beta ⇒ البطاقة تظهر).
  await page.goto(`${baseUrl}/fuel-stations/ops/manage`);
  const card = page.getByRole('link', { name: /Opening fuel balance/ });
  await card.waitFor();
  await shot(page, '01-hub');
  await card.click();

  const qty = page.locator('[data-testid^="qty-"]');
  await qty.first().waitFor();
  expect(await qty.count()).toBe(3);
  await shot(page, '02-tanks');
  await qty.nth(0).fill('30000');
  await qty.nth(1).fill('15555');
  await qty.nth(2).fill('31000');
  await page.locator('[data-action-bar] button[data-primary-action]').click();

  const costs = page.locator('[data-testid^="cost-"]');
  await costs.first().waitFor();
  await costs.nth(0).fill('2.18');
  await costs.nth(1).fill('2.33');
  await costs.nth(2).fill('1.66');
  // حسابات حقوق الملكية فقط، ولا حساب افتراضي: يختار المستخدم 3130 صراحةً.
  const select = page.locator('#op-account');
  await expect(select.locator('option')).not.toHaveCount(0);
  const labels = await select.locator('option').allTextContents();
  expect(labels.some((l) => l.startsWith('3130'))).toBe(true);
  expect(labels.every((l) => !/^1\d{3}/.test(l))).toBe(true); // لا أصول/التزامات
  await select.selectOption({ label: labels.find((l) => l.startsWith('3130'))! });
  await shot(page, '03-cost');
  await page.locator('[data-action-bar] button[data-primary-action]').click();

  await page.locator('[data-journal]').waitFor();
  await expect(page.locator('[data-ready="yes"]')).toBeVisible();
  await expect(page.locator('[data-journal]')).toContainText('153,103.15');
  await shot(page, '04-review');
  // المنشئ لا يعتمد مستنده (سياسة فصل المعتمِد): يُخبَر مسبقاً والزر معطَّل.
  await expect(page.locator('[data-distinct-approver]')).toBeVisible();
  await expect(page.locator('[data-action-bar] button[data-primary-action]')).toBeDisabled();
  await shot(page, '04b-creator-blocked');

  // مستخدم ثانٍ (مدير) يفتح المسودة المحفوظة من الشاشة نفسها ويراجعها ويعتمدها.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const second = JSON.parse(require('node:fs').readFileSync(APPROVER!, 'utf8'));
  const ctx2 = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx2.addCookies([{ name: 'locale', value: 'en', url: baseUrl }]);
  await ctx2.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', u); localStorage.setItem('theme', 'light'); }, [second.token, JSON.stringify(second.user)] as const);
  const page2 = await ctx2.newPage();
  page2.on('request', (r) => { if (r.url().startsWith(API) && r.method() !== 'GET' && r.method() !== 'OPTIONS') writes.push(`${r.method()} ${new URL(r.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}')} (approver)`); });
  await page2.goto(`${baseUrl}/fuel-stations/ops/opening-balance`);
  await expect(page2.getByText(/Continuing the saved draft/)).toBeVisible();
  await expect(page2.locator('[data-testid^="qty-"]').first()).toHaveValue('30000');
  await page2.locator('[data-action-bar] button[data-primary-action]').click();
  await page2.locator('[data-testid^="cost-"]').first().waitFor();
  await expect(page2.locator('[data-testid^="cost-"]').first()).toHaveValue('2.18');
  await page2.locator('[data-action-bar] button[data-primary-action]').click();
  await page2.locator('[data-journal]').waitFor();
  await expect(page2.locator('[data-distinct-approver]')).toHaveCount(0);
  await expect(page2.locator('[data-ready="yes"]')).toBeVisible();
  await shot(page2, '05-approver-review');
  await page2.locator('[data-action-bar] button[data-primary-action]').click();
  await page2.getByRole('dialog').waitFor();
  await page2.getByRole('dialog').locator('button[data-primary-action]').click();
  await page2.locator('[data-posted]').waitFor();
  await shot(page2, '06-posted');

  // الأثر في الخادم الحقيقي.
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const docs = await (await request.get(`${API}/fuel-stations/opening-balances`, { headers })).json();
  expect(docs.data).toHaveLength(1);
  expect(docs.data[0]).toMatchObject({ status: 'posted', total_milliliters: 76_555_000, total_value_minor: 15_310_315 });
  const tb = await (await request.get(`${API}/reports/trial-balance`, { headers })).json();
  const rows = JSON.stringify(tb);
  expect(rows).toContain('153103.15');
  const stock = await (await request.get(`${API}/fuel-stations/tanks`, { headers })).json();
  const books = (stock.data as Array<{ book_level: { milliliters: number } | null }>).map((t) => t.book_level?.milliliters ?? null);
  expect(books.sort()).toEqual([15_555_000, 30_000_000, 31_000_000]);

  // إعادة فتح الشاشة ⇒ «تم الإعداد مسبقاً» بلا معالج، والكتابات هي المتوقعة فقط.
  await page.goto(`${baseUrl}/fuel-stations/ops/opening-balance`);
  await expect(page.getByText('Already set up')).toBeVisible();
  await shot(page, '07-already');
  // المنشئ: حفظ الحساب ← مسودة؛ المعتمِد: PUT المسودة (المراجعة تعيد حفظ المحتوى نفسه) ← ترحيل. لا كتابة من المنشئ بعد الحجب.
  expect(writes.filter((w) => !w.endsWith('(approver)'))).toEqual(['PUT /api/fuel-stations/stations/{id}/settings', 'POST /api/fuel-stations/opening-balances']);
  expect(writes.filter((w) => w.endsWith('(approver)')).map((w) => w.replace(' (approver)', ''))).toEqual(['PUT /api/fuel-stations/opening-balances/{id}', 'POST /api/fuel-stations/opening-balances/{id}/post']);
  expect(errors).toEqual([]);
});
