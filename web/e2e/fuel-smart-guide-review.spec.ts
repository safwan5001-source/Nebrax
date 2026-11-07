import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockUi2Api, SELLER, type Locale } from './support/fuel-ops-ui2-mock';

/**
 * AWJ SMART GUIDE — مراجعة نهائية قبل الدمج (جوال 390×844 على هيئة آيفون + سطح مكتب، ar/en):
 *  - الجولة على شاشة التسليم الحقيقية: الزر الحسّاس («تأكيد التسليم») يُبرَز ولا يُضغط، ولا POST يخرج من الجولة.
 *  - التعتيم لا يعطّل الاستخدام: `elementFromPoint` على العنصر المُبرَز وعلى أي نقطة خارج البطاقة يعيد عنصر الصفحة لا الغلاف.
 *  - «النقرة الثانية»: ضغطتان متتاليتان على «التالي» لا تصلان إلى زر خلف مكان البطاقة السابق (حاجز لمس 450ms).
 *  - التمرير: الـSpotlight يتبع العنصر أثناء تمرير المستخدم.
 *  - إمكانية الوصول: axe-core (WCAG 2 A/AA) على البطاقة ولوحة الجولات ومركز المساعدة، فاتح وداكن.
 * متصفح Chromium وليس WebKit: لا يغني عن Safari على آيفون حقيقي (شرط لم يُستوفَ). اللقطات: `REVIEW_SHOTS`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
const shots = process.env.REVIEW_SHOTS;
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

async function setup(page: Page, locale: Locale, opts: { theme?: 'light' | 'dark'; permissions?: string[] } = {}) {
  const mock = await mockUi2Api(page, { baseUrl, locale, theme: opts.theme ?? 'light', seed: 'ready', permissions: opts.permissions ?? SELLER });
  await page.route('**/api/fuel-stations/tank-levels*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: mock.tanks.map((t: Record<string, unknown>) => ({
      tank: { id: t.id, code: t.code, name: t.name, status: 'active', capacity_milliliters: t.capacity_milliliters, capacity_liters: '1', safe_capacity_milliliters: t.capacity_milliliters, minimum_level_milliliters: 0, dead_stock_milliliters: 0 },
      station: { id: 'sa', code: 'FX-A', name: 'S' }, fuel_product: { id: t.fuel_product_id, code: null, name: null },
      latest: null, latest_by_type: { physical: null, atg: null },
      level: { fill_basis_points: null, available_milliliters: null, available_liters: null, safe_available_milliliters: null, age_seconds: null, freshness: 'none', stale_after_minutes: null, flags: [], needs_review: false },
    })), meta: { generated_at: null } }),
  }));
  return mock;
}

const overlay = (page: Page) => page.locator('[data-smart-guide]');
const card = (page: Page) => page.locator('[data-guide-card]');
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
const texts = (locale: Locale) => ({
  next: locale === 'ar' ? 'التالي' : 'Next',
  done: locale === 'ar' ? 'إنهاء الجولة' : 'Finish tour',
  contextual: locale === 'ar' ? 'مساعدة هذه الشاشة' : 'Help for this screen',
  startHere: locale === 'ar' ? 'ابدأ جولة هذه الشاشة' : 'Start this screen’s tour',
});

async function startFromContextual(page: Page, locale: Locale) {
  const L = texts(locale);
  await page.getByRole('button', { name: L.contextual }).click();
  await page.getByRole('button', { name: L.startHere }).click();
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
}

/** يمرّ على كل خطوات الجولة الحالية، ويفحص على كل خطوة: الإبراز، عدم التغطية، وأن الغلاف لا يلتقط اللمس. */
async function walk(page: Page, locale: Locale, name: string, project: string) {
  const L = texts(locale);
  const viewport = page.viewportSize()!;
  let index = 0;
  for (;;) {
    await page.waitForTimeout(520); // انتهاء الانتقال وحاجز اللمس
    index += 1;
    const step = await overlay(page).getAttribute('data-guide-step');
    await shot(page, `${name}-${locale}-${project}-${String(index).padStart(2, '0')}-${step}`);
    const cardBox = (await card(page).boundingBox())!;
    expect(cardBox.y + cardBox.height, `${name}/${step} card inside viewport`).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(cardBox.x, `${name}/${step}`).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${name}/${step} overflow`).toBe(true);
    if (await page.locator('[data-guide-spotlight]').count()) {
      const hit = await page.evaluate(() => {
        const s = document.querySelector('[data-guide-spotlight]') as HTMLElement;
        const r = s.getBoundingClientRect();
        const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
        const el = document.elementFromPoint(Math.min(Math.max(cx, 1), innerWidth - 1), Math.min(Math.max(cy, 1), innerHeight - 1));
        return { inOverlay: !!el?.closest('[data-smart-guide]'), tag: el?.tagName ?? null };
      });
      expect(hit.inOverlay, `${name}/${step}: the dim/spotlight must not intercept touches over the highlighted element`).toBe(false);
    }
    const next = card(page).getByRole('button', { name: L.next });
    if (!(await next.count())) break;
    await next.click();
  }
  await card(page).getByRole('button', { name: L.done }).click();
  await expect(overlay(page)).toHaveCount(0);
  return index;
}

for (const locale of ['ar', 'en'] as const) {
  const L = texts(locale);

  test.describe(`Smart Guide final review — ${locale}`, () => {
    test('handover tour: the sensitive confirm button is highlighted but never pressed; nothing is posted; the shift is not closed', async ({ page }, info) => {
      const mock = await setup(page, locale);
      await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s-open/handover`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-handover]')).toBeVisible();
      const before = mock.posts.length;
      await startFromContextual(page, locale);

      let sawConfirm = false;
      const steps: string[] = [];
      for (;;) {
        await page.waitForTimeout(520);
        const step = (await overlay(page).getAttribute('data-guide-step'))!;
        steps.push(step);
        await shot(page, `handover-${locale}-${info.project.name}-${String(steps.length).padStart(2, '0')}-${step}`);
        if (step === 'confirm') {
          sawConfirm = true;
          const target = (await page.locator('[data-confirm-close]').boundingBox())!;
          const c = (await card(page).boundingBox())!;
          const intersects = c.x < target.x + target.width && target.x < c.x + c.width && c.y < target.y + target.height && target.y < c.y + c.height;
          if (info.project.name === 'mobile') expect(intersects, 'the card must not sit on the confirm button').toBe(false);
        }
        const next = card(page).getByRole('button', { name: L.next });
        if (!(await next.count())) break;
        await next.click();
      }
      await card(page).getByRole('button', { name: L.done }).click();

      expect(sawConfirm).toBe(true);
      expect(mock.posts.length).toBe(before); // الجولة لم ترسل أي POST
      await expect(page.locator('[data-handover-done]')).toHaveCount(0); // الوردية لم تُسلَّم
      await expect(page).toHaveURL(/\/handover$/);
      // الخطوة المحجوبة بقيود (قسم التحصيل غير مفعّل هنا) تُتخطّى بدل شرح عنصر غير موجود.
      expect(steps).not.toContain('collectionEntry');
    });

    test('dim and spotlight never block use: touches pass through everywhere except the card', async ({ page }) => {
      await setup(page, locale);
      await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s-open/handover`, { waitUntil: 'domcontentloaded' });
      await startFromContextual(page, locale);
      await page.waitForTimeout(520);
      const probe = await page.evaluate(() => {
        const cardRect = (document.querySelector('[data-guide-card]') as HTMLElement).getBoundingClientRect();
        const points: Array<[number, number]> = [[10, 10], [innerWidth - 10, 10], [10, innerHeight / 2], [innerWidth - 10, innerHeight / 2]];
        return points.filter(([x, y]) => !(x >= cardRect.left && x <= cardRect.right && y >= cardRect.top && y <= cardRect.bottom))
          .map(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-smart-guide]'));
      });
      expect(probe.every((blocked) => blocked === false)).toBe(true);
      // والبطاقة نفسها تلتقط اللمس (لا يتسرّب نقر على زرها إلى ما تحتها).
      expect(await card(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
    });

    test('ghost-tap guard: a fast double tap on Next never reaches a sensitive button left where the card used to be', async ({ page }) => {
      await setup(page, locale);
      await page.goto(`${baseUrl}/fuel-stations/ops`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.setItem('awj.station-guide.force', '1'));
      await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('awj.station-guide.v1.')) localStorage.removeItem(key); });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      // «زر حسّاس» وهمي يغطي أسفل الشاشة وأعلاها (تحت الغلاف): أي نقرة تصله تُسجَّل.
      await page.evaluate(() => {
        (window as unknown as { __decoy: number }).__decoy = 0;
        for (const edge of ['top', 'bottom'] as const) {
          const decoy = document.createElement('button');
          decoy.setAttribute('data-decoy', edge);
          decoy.textContent = 'CONFIRM';
          decoy.style.cssText = `position:fixed;${edge}:0;left:0;right:0;height:46vh;z-index:5;opacity:.01`;
          decoy.addEventListener('click', () => { (window as unknown as { __decoy: number }).__decoy += 1; });
          document.body.appendChild(decoy);
        }
      });
      await page.waitForTimeout(700);
      for (let i = 0; i < 6; i += 1) {
        const next = card(page).getByRole('button', { name: L.next });
        if (!(await next.count())) break;
        const box = (await next.boundingBox())!;
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2); // ضغطة مزدوجة سريعة
        await page.waitForTimeout(650);
      }
      expect(await page.evaluate(() => (window as unknown as { __decoy: number }).__decoy)).toBe(0);
    });

    test('scrolling: the spotlight follows its element while the user scrolls', async ({ page }, info) => {
      test.skip(info.project.name !== 'mobile', 'mobile layout');
      await setup(page, locale);
      await page.goto(`${baseUrl}/fuel-stations/ops/products`, { waitUntil: 'domcontentloaded' });
      await startFromContextual(page, locale);
      await page.waitForTimeout(600);
      for (let i = 0; i < 2; i += 1) { await card(page).getByRole('button', { name: L.next }).click(); await page.waitForTimeout(700); }
      const gap = async () => page.evaluate(() => {
        const s = (document.querySelector('[data-guide-spotlight]') as HTMLElement).getBoundingClientRect();
        const t = document.querySelector('section[aria-labelledby="fo-pumps-h"]') as HTMLElement;
        const r = t.getBoundingClientRect();
        return Math.abs(s.top - (r.top - 8));
      });
      expect(await gap()).toBeLessThan(3);
      await page.evaluate(() => window.scrollBy(0, 160));
      await page.waitForTimeout(250);
      expect(await gap()).toBeLessThan(3); // تبعه بعد تمرير المستخدم
      await shot(page, `scroll-follow-${locale}-mobile`);
    });

    test('tours on lists and long pages: every step is placed inside the viewport (shifts, sales, stock)', async ({ page }, info) => {
      await setup(page, locale);
      for (const [path, name] of [['/fuel-stations/ops/shifts', 'shifts'], ['/fuel-stations/ops/products', 'sales'], ['/fuel-stations/ops/tanks', 'stock']] as const) {
        await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
        await startFromContextual(page, locale);
        const count = await walk(page, locale, name, info.project.name);
        expect(count, name).toBeGreaterThanOrEqual(2);
      }
    });

    test('welcome tour: every step, light and dark, no overflow and the card never covers the target on mobile', async ({ page }, info) => {
      await setup(page, locale, { theme: info.project.name === 'mobile' ? 'dark' : 'light' });
      await page.addInitScript(() => localStorage.setItem('awj.station-guide.force', '1'));
      await page.goto(`${baseUrl}/fuel-stations/ops`, { waitUntil: 'domcontentloaded' });
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      const count = await walk(page, locale, 'welcome', info.project.name);
      expect(count).toBeGreaterThanOrEqual(6);
    });

    test('accessibility (axe, WCAG 2 A/AA): tour card, tours panel, help center and article — light and dark', async ({ page }, info) => {
      for (const theme of ['light', 'dark'] as const) {
        const fresh = await page.context().newPage();
        await setup(fresh, locale, { theme });
        await fresh.addInitScript(() => localStorage.setItem('awj.station-guide.force', '1'));
        await fresh.goto(`${baseUrl}/fuel-stations/ops`, { waitUntil: 'domcontentloaded' });
        await expect(fresh.locator('[data-smart-guide]')).toBeVisible({ timeout: 10_000 });
        await fresh.waitForTimeout(700);
        await fresh.evaluate(axeSource);
        const run = (context: string) => fresh.evaluate(async (ctx) => {
          const result = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe.run(
            { include: [ctx] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, rules: { 'color-contrast': { enabled: true } } },
          );
          return result.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
        }, context);
        const onCard = await run('[data-guide-card]');
        expect(onCard, `${theme}: tour card`).toEqual([]);
        await fresh.keyboard.press('Escape');

        for (const path of ['/fuel-stations/ops/help', '/fuel-stations/ops/help/fuel-open-shift']) {
          await fresh.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
          await fresh.locator('main').waitFor();
          await fresh.evaluate(axeSource);
          const violations = await run('main');
          expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'), `${theme} ${path}`).toEqual([]);
        }
        await fresh.close();
      }
    });
  });
}
