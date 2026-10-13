import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * INT-UX-2 — التحقق البصري والسلوكي لكتالوج منصات التوصيل وتفاصيلها في متصفح حقيقي.
 *
 * يعمل ضد خادم الواجهة فقط: كل طلب `/api/*` يُعترَض ويُجاب ببيانات محكومة (لا خلفية ولا أي
 * اتصال بمزوّد). لكل مشروع Playwright (مكتب 1440 وجوال 390) × عربي RTL وإنجليزي LTR × فاتح وداكن.
 * اللقطات تُكتب فقط حين يُضبط `INT_UX2_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.INT_UX2_SHOTS;

type Scenario = 'allowed' | 'app_off' | 'readiness_error' | 'profiles_error' | 'slow';
type Viewer = 'owner' | 'accountant' | 'denied';

const SIX = [
  ['hungerstation', 'هنقرستيشن', 'HungerStation', 'OWNER_GATE', 'AWAITING_PROVIDER_APPROVAL'],
  ['jahez', 'جاهز', 'Jahez', 'BLOCKED', 'NOT_SUPPORTED'],
  ['mrsool', 'مرسول', 'Mrsool', 'BLOCKED', 'NOT_SUPPORTED'],
  ['keeta', 'كيتا', 'Keeta', 'OWNER_GATE', 'AWAITING_PROVIDER_APPROVAL'],
  ['ninja', 'نينجا', 'Ninja', 'BLOCKED', 'NOT_SUPPORTED'],
  ['the_chefz', 'ذا شيفز', 'The Chefz', 'BLOCKED', 'NOT_SUPPORTED'],
] as const;

function readiness(withEvidence: boolean) {
  return SIX.map(([platform_key, name, name_en, technical, ux_state]) => ({
    platform_key, name, name_en, ux_state, connect_enabled: false, sync_enabled: false,
    ...(withEvidence ? { technical, evidence_date: '2026-10-11', evidence_ref: `docs/plans/pos/DLV-PROVIDER-READINESS-1-REPORT.md §${platform_key}` } : {}),
  }));
}

async function mockApi(page: Page, scenario: Scenario, viewer: Viewer, requests: string[]) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push(`${route.request().method()} ${path}`);
    if (route.request().method() !== 'GET') return json(route, { data: [] });
    if (path === '/applications/nav-state') return json(route, { data: { 'sales.pos': scenario !== 'app_off' } });
    if (path === '/delivery-platforms/readiness') {
      if (scenario === 'readiness_error') return json(route, { message: 'down' }, 500);
      return json(route, { data: readiness(viewer === 'owner') });
    }
    if (path === '/delivery-platforms') {
      if (scenario === 'profiles_error') return json(route, { message: 'down' }, 500);
      if (scenario === 'slow') await new Promise((resolve) => setTimeout(resolve, 2500));
      return json(route, { data: [
        { id: 'p1', platform_key: 'keeta', is_active: true },
        { id: 'p2', platform_key: 'jahez', is_active: false },
      ] });
    }
    if (path === '/me') return json(route, { user: { id: 'u1', name: 'المالك', role: 'owner', permissions: ['*'] }, company: { name: 'نبراس الطموح' } });
    return json(route, { data: [] });
  });
}

async function open(page: Page, path: string, opts: { scenario?: Scenario; locale: 'ar' | 'en'; theme: 'light' | 'dark'; viewer?: Viewer }) {
  const requests: string[] = [];
  const viewer = opts.viewer ?? 'owner';
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  await mockApi(page, opts.scenario ?? 'allowed', viewer, requests);
  const users = {
    owner: { role: 'owner', permissions: ['*'] },
    accountant: { role: 'accountant', permissions: ['invoices.view', 'reports.view'] },
    denied: { role: 'custom', permissions: ['reports.view'] },
  } as const;
  const user = { id: 'u1', name: 'المالك', email: 'o@test', tenant_id: 't1', ...users[viewer] };
  await page.addInitScript(([theme, userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [opts.theme, JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  return requests;
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function contrast(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const parse = (value: string) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.99) { bg = c; break; }
    }
    const fg = parse(getComputedStyle(el).color)!;
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  }, selector);
}

const LOCALES = [['ar', 'rtl'], ['en', 'ltr']] as const;
const THEMES = ['light', 'dark'] as const;

for (const [locale, dir] of LOCALES) {
  for (const theme of THEMES) {
    test.describe(`${locale}/${theme}`, () => {
      test('catalog: six platforms, one layout per viewport, no controls, AA contrast', async ({ page }, info) => {
        await open(page, '/integrations/delivery-platforms', { locale, theme });
        const root = page.getByTestId('delivery-platform-catalog');
        await expect(root).toBeVisible();
        const mobile = info.project.name === 'mobile';

        const container = page.getByTestId(mobile ? 'catalog-cards' : 'catalog-table');
        await expect(container).toBeVisible();
        await expect(page.getByTestId(mobile ? 'catalog-table' : 'catalog-cards')).toBeHidden();
        const order = await container.locator('[data-platform]').evaluateAll((els) => els.map((el) => el.getAttribute('data-platform')));
        expect(order).toEqual(['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz']);

        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
        expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

        // لا أزرار ولا حقول ولا عناصر معطّلة — حتى الظاهر منها وحده.
        expect(await root.locator('button, input, select, textarea, form, [disabled], [aria-disabled="true"]').count()).toBe(0);
        const text = (await root.innerText()).toLowerCase();
        expect(text).not.toMatch(/connect now|connect account|authorize|oauth|reconnect|start sync|sync now|credential|api key|ربط الآن|إعادة الربط|بدء المزامنة|بيانات الاعتماد/);

        // الجاهزية من الاستجابة: كيتا وهنقرستيشن «بانتظار اتفاق»، والباقي «غير متاح»، ولا «متاح» لأحد.
        const bTexts = await container.locator('[data-ladder-step="b"]').allInnerTexts();
        expect(bTexts).toHaveLength(6);
        expect(bTexts.filter((t) => /pending agreement|بانتظار اتفاق/i.test(t))).toHaveLength(2);
        expect(bTexts.filter((t) => /^(available|متاح)$/i.test(t.trim()))).toHaveLength(0);

        for (const sel of [
          'h1',
          '[data-ladder-step="a"]',
          '[data-ladder-step="b"]',
          '[data-ladder-step="c"]',
          '[data-testid="catalog-boundary"]',
          '[data-testid="integration-breadcrumb"] li:first-child a',
        ]) {
          const selector = `${mobile ? '[data-testid="catalog-cards"] ' : '[data-testid="catalog-table"] '}${sel}`.replace(/^\S+ (h1|\[data-testid="catalog-boundary"\]|\[data-testid="integration-breadcrumb"\].*)$/, '$1');
          const ratio = await contrast(page, selector);
          expect(ratio, `${selector} contrast`).not.toBeNull();
          expect(ratio!, `${selector} contrast ${ratio}`).toBeGreaterThanOrEqual(4.5);
        }
        await shot(page, `${info.project.name}-${locale}-${theme}-catalog`);
      });

      test('navigation: Integration Center → catalog → detail → back through the breadcrumb', async ({ page }) => {
        await open(page, '/integrations', { locale, theme });
        await page.getByTestId('integration-card-delivery').click();
        await expect(page).toHaveURL(/\/integrations\/delivery-platforms$/);
        await expect(page.getByTestId('delivery-platform-catalog')).toBeVisible();

        await page.locator('[data-platform="keeta"] a[href$="/keeta"]:visible').first().click();
        await expect(page).toHaveURL(/\/integrations\/delivery-platforms\/keeta$/);
        await expect(page.getByTestId('delivery-platform-detail')).toBeVisible();

        await page.getByTestId('integration-breadcrumb').getByRole('link').nth(1).click();
        await expect(page).toHaveURL(/\/integrations\/delivery-platforms$/);
        await page.getByTestId('integration-breadcrumb').getByRole('link').first().click();
        await expect(page).toHaveURL(/\/integrations$/);
        await expect(page.getByTestId('integration-center')).toBeVisible();
      });

      test('detail (Keeta): four ladder rows, signed-ingress distinction, no controls, AA contrast', async ({ page }, info) => {
        await open(page, '/integrations/delivery-platforms/keeta', { locale, theme });
        const root = page.getByTestId('delivery-platform-detail');
        await expect(root.getByTestId('capability-ladder')).toBeVisible();

        const rows = await root.locator('[data-ladder-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-ladder-row')));
        expect(rows).toEqual(['a', 'b', 'c', 'd']);
        await expect(root.getByTestId('ingress-note')).toBeVisible();
        await expect(root.getByTestId('requires-list').locator('li')).toHaveCount(3);
        await expect(root.getByTestId('detail-advanced')).toContainText('OWNER_GATE');

        expect(await root.locator('button, input, select, textarea, form, [disabled], [aria-disabled="true"]').count()).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        const text = (await root.innerText()).toLowerCase();
        expect(text).not.toMatch(/connect now|connect account|authorize|oauth|reconnect|start sync|sync now|enter credentials|api key|ربط الآن|إعادة الربط|بدء المزامنة|أدخل بيانات/);

        for (const sel of [
          'h1',
          '[data-testid="capability-ladder"] dt',
          '[data-ladder-step="b"]',
          '[data-testid="capability-ladder"] dd p',
          '[data-testid="ingress-note"] p',
          '[data-testid="requires-list"] li span:last-child',
          '[data-testid="detail-boundaries"] p',
          '[data-testid="detail-advanced"] dd',
        ]) {
          const ratio = await contrast(page, `[data-testid="delivery-platform-detail"] ${sel}`);
          expect(ratio, `${sel} contrast`).not.toBeNull();
          expect(ratio!, `${sel} contrast ${ratio}`).toBeGreaterThanOrEqual(4.5);
        }
        await shot(page, `${info.project.name}-${locale}-${theme}-detail-keeta`);
      });
    });
  }
}

test.describe('every provider detail page (ar/light and en/dark)', () => {
  for (const [key, , , , ux] of SIX) {
    for (const [locale, theme] of [['ar', 'light'], ['en', 'dark']] as const) {
      test(`${key} (${locale}/${theme})`, async ({ page }, info) => {
        await open(page, `/integrations/delivery-platforms/${key}`, { locale, theme });
        const ladder = page.getByTestId('capability-ladder');
        await expect(ladder).toBeVisible();
        const b = (await ladder.locator('[data-ladder-step="b"]').innerText()).trim();
        expect(b).toMatch(ux === 'AWAITING_PROVIDER_APPROVAL' ? /pending agreement|بانتظار اتفاق/i : /not available|غير متاح/i);
        await expect(ladder.locator('[data-ladder-step="c"]')).toContainText(/unavailable until a native integration exists|غير متاح قبل توفر تكامل أصلي/);
        expect(await page.getByTestId('delivery-platform-detail').locator('button, input, [disabled]').count()).toBe(0);
        if (key !== 'keeta') await shot(page, `${info.project.name}-${locale}-${theme}-detail-${key}`);
      });
    }
  }
});

test.describe('states', () => {
  for (const [locale, theme] of [['ar', 'light'], ['en', 'dark']] as const) {
    test(`catalog loading → ready (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, '/integrations/delivery-platforms', { scenario: 'slow', locale, theme });
      await expect(page.getByTestId('catalog-loading')).toBeVisible();
      await shot(page, `${info.project.name}-${locale}-${theme}-catalog-loading`);
      await expect(page.getByTestId(info.project.name === 'mobile' ? 'catalog-cards' : 'catalog-table')).toBeVisible({ timeout: 8000 });
    });

    test(`catalog: readiness API failure is unreadable with retry (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, '/integrations/delivery-platforms', { scenario: 'readiness_error', locale, theme });
      await expect(page.getByTestId('catalog-read-error')).toBeVisible();
      const container = page.getByTestId(info.project.name === 'mobile' ? 'catalog-cards' : 'catalog-table');
      const bTexts = await container.locator('[data-ladder-step="b"]').allInnerTexts();
      expect(bTexts.every((t) => /could not be read|تعذّرت القراءة/i.test(t))).toBe(true);
      expect(await container.innerText()).not.toMatch(/not available|غير متاح\b(?! قبل)/i);
      await expect(page.getByTestId('catalog-read-error').getByRole('button')).toHaveCount(1);
      await shot(page, `${info.project.name}-${locale}-${theme}-catalog-error`);
    });

    test(`catalog: profiles API failure leaves native readiness intact (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, '/integrations/delivery-platforms', { scenario: 'profiles_error', locale, theme });
      await expect(page.getByTestId('catalog-read-error')).toBeVisible();
      const container = page.getByTestId(info.project.name === 'mobile' ? 'catalog-cards' : 'catalog-table');
      const a = await container.locator('[data-ladder-step="a"]').allInnerTexts();
      expect(a.every((t) => /could not be read|تعذّرت القراءة/i.test(t))).toBe(true);
      const b = await container.locator('[data-ladder-step="b"]').allInnerTexts();
      expect(b.some((t) => /pending agreement|بانتظار اتفاق/i.test(t))).toBe(true);
    });

    test(`permission denied (${locale}/${theme})`, async ({ page }, info) => {
      const requests = await open(page, '/integrations/delivery-platforms', { locale, theme, viewer: 'denied' });
      await expect(page.getByTestId('integration-restricted')).toHaveAttribute('data-state', 'denied');
      expect(requests.filter((r) => r.includes('/delivery-platforms') || r.includes('nav-state'))).toEqual([]);
      await shot(page, `${info.project.name}-${locale}-${theme}-catalog-denied`);
    });

    test(`POS application off (${locale}/${theme})`, async ({ page }, info) => {
      const requests = await open(page, '/integrations/delivery-platforms/keeta', { scenario: 'app_off', locale, theme });
      await expect(page.getByTestId('integration-restricted')).toHaveAttribute('data-state', 'app_off');
      expect(requests.filter((r) => r.includes('/delivery-platforms'))).toEqual([]);
      await shot(page, `${info.project.name}-${locale}-${theme}-detail-app-off`);
    });

    test(`unknown platform key: not found, zero data requests (${locale}/${theme})`, async ({ page }, info) => {
      const requests = await open(page, '/integrations/delivery-platforms/talabat', { locale, theme });
      await expect(page.getByTestId('delivery-platform-unknown')).toBeVisible();
      expect(requests.filter((r) => r.includes('/delivery-platforms') || r.includes('nav-state'))).toEqual([]);
      await shot(page, `${info.project.name}-${locale}-${theme}-detail-unknown`);
    });
  }

  test('an accountant gets the public fields only: no internal evidence on screen', async ({ page }) => {
    await open(page, '/integrations/delivery-platforms/keeta', { locale: 'en', theme: 'light', viewer: 'accountant' });
    await expect(page.getByTestId('capability-ladder')).toBeVisible();
    await expect(page.getByTestId('detail-advanced')).toHaveCount(0);
    expect(await page.getByTestId('delivery-platform-detail').innerText()).not.toContain('OWNER_GATE');
    await expect(page.getByTestId('works-today').locator('a[href="/delivery-hub"]')).toHaveCount(0);
    await expect(page.getByTestId('works-today').locator('a[href="/reports/sales/delivery-channel"]')).toHaveCount(1);
  });
});

test('keyboard: the catalog links are reachable and show a visible focus indicator', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'touch viewport; keyboard path verified on desktop');
  await open(page, '/integrations/delivery-platforms', { locale: 'en', theme: 'light' });
  const first = page.locator('[data-testid="catalog-table"] a[href$="/hungerstation"]').first();
  await first.focus();
  const indicator = await first.evaluate((el) => {
    const s = getComputedStyle(el);
    return { shadow: s.boxShadow, outline: s.outlineStyle };
  });
  expect(indicator.shadow !== 'none' || indicator.outline !== 'none').toBe(true);

  // Tab يعبر روابط الصفوف الستة بالترتيب ثم يغادر الكتالوج.
  const visited: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    visited.push(await page.evaluate(() => document.activeElement?.getAttribute('href') ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(visited.map((href) => href.split('/').pop())).toEqual(['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz']);
});
