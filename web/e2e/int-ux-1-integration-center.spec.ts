import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * INT-UX-1 — التحقق البصري والسلوكي لمركز التكاملات في متصفح حقيقي.
 *
 * يعمل ضد خادم الواجهة فقط: كل طلب `/api/*` يُعترَض ويُجاب ببيانات محكومة، فلا خلفية
 * ولا أي اتصال بمزوّد. يُجرى لكل مشروع Playwright (سطح مكتب 1440 وجوال 390)، بالعربية
 * RTL والإنجليزية LTR، وبالوضعين الفاتح والداكن. اللقطات تُكتب فقط حين يُضبط
 * `INT_UX1_SHOTS` (مجلد خارج المستودع)؛ بدونه تبقى الاختبارات تحققاً لا تصويراً.
 *
 * تشغيل: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=… npx playwright test e2e/int-ux-1-integration-center.spec.ts
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.INT_UX1_SHOTS;

type Scenario = 'allowed' | 'app_off' | 'denied' | 'summary_error' | 'slow' | 'native_ready';

const SIX = [
  ['hungerstation', 'هنقرستيشن', 'HungerStation', 'OWNER_GATE', 'AWAITING_PROVIDER_APPROVAL'],
  ['jahez', 'جاهز', 'Jahez', 'BLOCKED', 'NOT_SUPPORTED'],
  ['mrsool', 'مرسول', 'Mrsool', 'BLOCKED', 'NOT_SUPPORTED'],
  ['keeta', 'كيتا', 'Keeta', 'OWNER_GATE', 'AWAITING_PROVIDER_APPROVAL'],
  ['ninja', 'نينجا', 'Ninja', 'BLOCKED', 'NOT_SUPPORTED'],
  ['the_chefz', 'ذا شيفز', 'The Chefz', 'BLOCKED', 'NOT_SUPPORTED'],
] as const;

function readiness(ready: boolean) {
  return SIX.map(([platform_key, name, name_en, , ux]) => ({
    platform_key, name, name_en,
    ux_state: ready && platform_key === 'keeta' ? 'READY_TO_CONNECT' : ux,
    connect_enabled: ready && platform_key === 'keeta',
    sync_enabled: false,
  }));
}

async function mockApi(page: Page, scenario: Scenario) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (route.request().method() !== 'GET') return json(route, { data: [] });
    if (path === '/applications/nav-state') {
      return json(route, { data: { 'sales.pos': scenario !== 'app_off', 'company.branches': true } });
    }
    if (path === '/delivery-platforms/readiness') {
      if (scenario === 'summary_error') return json(route, { message: 'down' }, 500);
      return json(route, { data: readiness(scenario === 'native_ready') });
    }
    if (path === '/delivery-platforms') {
      if (scenario === 'summary_error') return json(route, { message: 'down' }, 500);
      if (scenario === 'slow') await new Promise((resolve) => setTimeout(resolve, 2500));
      return json(route, { data: [
        { id: 'p1', platform_key: 'keeta', is_active: true },
        { id: 'p2', platform_key: 'jahez', is_active: true },
        { id: 'p3', platform_key: 'ninja', is_active: false },
      ] });
    }
    if (path === '/me') return json(route, { user: { id: 'u1', name: 'المالك', role: 'owner', permissions: ['*'] }, company: { name: 'نبراس الطموح' } });
    return json(route, { data: [] });
  });
}

async function open(page: Page, opts: { scenario: Scenario; locale: 'ar' | 'en'; theme: 'light' | 'dark'; permissions?: string[]; role?: string }) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  await mockApi(page, opts.scenario);
  const user = {
    id: 'u1', name: 'المالك', email: 'owner@test', tenant_id: 't1',
    role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'],
  };
  await page.addInitScript(([theme, userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [opts.theme, JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/integrations`, { waitUntil: 'domcontentloaded' });
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

/** نسبة التباين WCAG بين لون النص والخلفية الفعلية (أول سلف غير شفاف). */
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
      test('landing: composition, direction, one tab stop, inert future cards, contrast', async ({ page }, info) => {
        await open(page, { scenario: 'allowed', locale, theme });
        const root = page.getByTestId('integration-center');
        await expect(root).toBeVisible();
        await expect(page.getByTestId('integration-center-summary')).toBeVisible();

        // الاتجاه واللغة.
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
        expect(await page.evaluate(() => document.documentElement.lang)).toBe(locale);
        expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark');

        // ترتيب البطاقات وتكوينها: شبكة 2×2 على المكتب (RTL: التوصيل يمين المتاجر)، وعمود واحد على الجوال.
        const box = async (id: string) => (await page.getByTestId(`integration-card-${id}`).boundingBox())!;
        const [d, e, p, s, c] = [await box('delivery'), await box('ecommerce'), await box('payments'), await box('shipping'), await box('communications')];
        if (info.project.name === 'mobile') {
          expect(new Set([d.x, e.x, p.x, s.x, c.x].map(Math.round)).size).toBe(1);
          expect(d.y).toBeLessThan(e.y);
          expect(e.y).toBeLessThan(p.y);
          expect(p.y).toBeLessThan(s.y);
          expect(s.y).toBeLessThan(c.y);
        } else {
          // AWJ-COMMS-UX-01: البطاقة الخامسة تبدأ صفاً ثالثاً عند حافة البداية نفسها، دون أن تحرّك المواضع المعتمدة.
          expect(c.y).toBeGreaterThan(p.y + p.height - 1);
          expect(Math.abs(c.x - p.x)).toBeLessThan(2);
          expect(Math.abs(d.y - e.y)).toBeLessThan(2);
          expect(Math.abs(p.y - s.y)).toBeLessThan(2);
          expect(p.y).toBeGreaterThan(d.y + d.height - 1);
          if (dir === 'rtl') { expect(d.x).toBeGreaterThan(e.x); expect(p.x).toBeGreaterThan(s.x); }
          else { expect(d.x).toBeLessThan(e.x); expect(p.x).toBeLessThan(s.x); }
        }

        // لا تمرير أفقي للصفحة.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

        // مكانا تركيز في المركز (منصات التوصيل ثم مزوّدو الاتصالات)، والخاملة لا تُركَّز ولا تُنقَر.
        expect(await root.locator('a[href], button, input, select, textarea, [tabindex]').count()).toBe(2);
        const delivery = page.getByTestId('integration-card-delivery');
        await delivery.focus();
        expect(await delivery.evaluate((el) => el === document.activeElement)).toBe(true);
        await page.keyboard.press('Tab');
        expect(await page.getByTestId('integration-card-communications').evaluate((el) => el === document.activeElement)).toBe(true);
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="integration-center"]'))).toBe(false);
        const urlBefore = page.url();
        for (const id of ['ecommerce', 'payments', 'shipping']) {
          await page.getByTestId(`integration-card-${id}`).click({ force: true });
          expect(page.url()).toBe(urlBefore);
        }

        // لا ربط ولا مزامنة ولا وعد إطلاق، ولا الأخضر المالي في الشارة.
        const text = (await root.innerText()).toLowerCase();
        expect(text).not.toMatch(/connect|authorize|oauth|sync|coming soon|ربط|تفويض|مزامنة|قريباً|ضمن التصميم|القسم الأول/);
        expect(await root.locator('[class*="positive"]').count()).toBe(0);

        // تباين AA للنصوص الأساسية والخافتة والشارة.
        for (const sel of [
          'h1',
          '[data-testid="integration-card-delivery"] h2',
          '[data-testid="integration-card-delivery"] p',
          '[data-testid="integration-card-delivery"] span.bg-primary-soft',
          '[data-testid="integration-center-summary"] li',
          '[data-testid="integration-card-ecommerce"] p',
          '[data-testid="integration-card-communications"] h2',
          '[data-testid="integration-card-communications"] p',
          '[data-testid="integration-card-communications"] span',
          '[data-testid="integration-center-planned-note"]',
        ]) {
          const ratio = await contrast(page, sel);
          expect(ratio, `${sel} contrast`).not.toBeNull();
          expect(ratio!, `${sel} contrast ${ratio}`).toBeGreaterThanOrEqual(4.5);
        }

        await shot(page, `${info.project.name}-${locale}-${theme}-allowed`);
      });

      test('delivery card enters the catalog inside the Integration Center', async ({ page }) => {
        await open(page, { scenario: 'allowed', locale, theme });
        await page.getByTestId('integration-card-delivery').click();
        await expect(page).toHaveURL(/\/integrations\/delivery-platforms$/);
      });
    });
  }
}

test.describe('states (ar/light and en/dark)', () => {
  for (const [locale, theme] of [['ar', 'light'], ['en', 'dark']] as const) {
    test(`loading skeleton then ready (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, { scenario: 'slow', locale, theme });
      await expect(page.getByTestId('integration-center-summary-loading')).toBeVisible();
      await expect(page.getByTestId('integration-card-delivery')).toBeVisible();
      await shot(page, `${info.project.name}-${locale}-${theme}-summary-loading`);
      await expect(page.getByTestId('integration-center-summary')).toBeVisible({ timeout: 8000 });
    });

    test(`permission denied (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, { scenario: 'allowed', locale, theme, role: 'custom', permissions: ['reports.view'] });
      const card = page.getByTestId('integration-card-delivery');
      await expect(card).toHaveAttribute('data-state', 'denied');
      await expect(page.getByTestId('integration-card-communications')).toHaveAttribute('data-state', 'denied');
      expect(await page.getByTestId('integration-center').locator('a[href]').count()).toBe(0);
      await shot(page, `${info.project.name}-${locale}-${theme}-denied`);
    });

    test(`application off (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, { scenario: 'app_off', locale, theme });
      const card = page.getByTestId('integration-card-delivery');
      await expect(card).toHaveAttribute('data-state', 'app_off');
      await expect(card.locator('a[href="/applications"]')).toHaveCount(1);
      await shot(page, `${info.project.name}-${locale}-${theme}-app-off`);
    });

    test(`summary error keeps the card usable (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, { scenario: 'summary_error', locale, theme });
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByTestId('integration-card-delivery')).toHaveAttribute('data-state', 'allowed');
      await shot(page, `${info.project.name}-${locale}-${theme}-summary-error`);
    });
  }

  test('a native integration being available is reported only from the readiness data', async ({ page }) => {
    await open(page, { scenario: 'native_ready', locale: 'en', theme: 'light' });
    await expect(page.getByTestId('integration-center-summary')).toContainText('1 available');
    // حتى مع جاهزية مزوّد لا يوجد فعل ربط في هذه الشريحة.
    expect(await page.getByTestId('integration-center').locator('button').count()).toBe(0);
  });
});

test('the sidebar lists the entry under Settings for a user with invoices.view', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the drawer is exercised on desktop; mobile covers the page itself');
  await open(page, { scenario: 'allowed', locale: 'en', theme: 'light' });
  const link = page.locator('aside a[href="/integrations"]');
  await expect(link).toHaveCount(1);
  await expect(link).toContainText('Integration Center');
  await expect(link).toHaveAttribute('aria-current', 'page');
});

// ── AWJ-COMMS-UX-01: كتالوج مزوّدي الاتصالات (ثابت، بلا شبكة) ──────────────────────────────────────
const PROVIDER_KEYS = [
  'unifonic', 'twilio-sms', 'whatsapp-business-platform', 'amazon-ses', 'postmark',
  'firebase-cloud-messaging', 'apple-push-notification-service',
];

async function openCommunications(page: Page, opts: { locale: 'ar' | 'en'; theme: 'light' | 'dark'; permissions?: string[]; role?: string }) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  await mockApi(page, 'allowed');
  const user = {
    id: 'u1', name: 'المالك', email: 'owner@test', tenant_id: 't1',
    role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'],
  };
  await page.addInitScript(([theme, userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [opts.theme, JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/integrations/communications`, { waitUntil: 'domcontentloaded' });
}

for (const [locale, dir] of LOCALES) {
  for (const theme of THEMES) {
    test.describe(`communications catalog ${locale}/${theme}`, () => {
      test('lists known providers honestly: no connected claim, no controls, official WhatsApp logo only, responsive, AA contrast', async ({ page }, info) => {
        const requests: string[] = [];
        page.on('request', (request) => { if (new URL(request.url()).pathname.includes('/api/')) requests.push(request.url()); });
        await openCommunications(page, { locale, theme });
        const root = page.getByTestId('communications-catalog');
        await expect(root).toBeVisible();

        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
        expect(await page.evaluate(() => document.documentElement.lang)).toBe(locale);
        expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark');

        for (const key of PROVIDER_KEYS) await expect(page.getByTestId(`communications-provider-${key}`)).toBeVisible();
        await expect(page.getByTestId('communications-truth-note')).toBeVisible();

        // لا شيء يُصوَّر متصلاً، ولا عنصر تحكم، والرابط الوحيد مسار التنقّل.
        expect(await root.locator('[data-status="connected"]').count()).toBe(0);
        expect(await root.locator('button, input, select, textarea, form').count()).toBe(0);
        expect(await root.locator('a[href]').count()).toBe(1);
        expect(await root.locator('[class*="positive"]').count()).toBe(0);

        // الشعار الرسمي لـWhatsApp فقط وقد حُمِّل فعلاً؛ الباقي أيقونة عامة. لا طلب خارجي لصور.
        const logos = root.locator('img[data-mark="official"]');
        await expect(logos).toHaveCount(1);
        expect(await logos.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
        expect(await root.locator('[data-mark="generic"]').count()).toBe(PROVIDER_KEYS.length - 1);

        // الصفحة ثابتة: لا تطلب شيئاً خاصاً بها (طلبات هيكل التطبيق العامة كالإشعارات والفروع ليست منها).
        expect(requests.filter((url) => /delivery|communication|provider|integration/i.test(new URL(url).pathname))).toEqual([]);

        // لا تمرير أفقي، وبطاقات المزوّدين داخل حدود الشاشة.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        const widthLimit = await page.evaluate(() => window.innerWidth);
        for (const key of PROVIDER_KEYS) {
          const box = (await page.getByTestId(`communications-provider-${key}`).boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(-1);
          expect(box.x + box.width).toBeLessThanOrEqual(widthLimit + 1);
        }
        if (info.project.name === 'mobile') {
          const first = (await page.getByTestId('communications-provider-unifonic').boundingBox())!;
          const second = (await page.getByTestId('communications-provider-twilio-sms').boundingBox())!;
          expect(Math.round(first.x)).toBe(Math.round(second.x));
        }

        for (const sel of [
          'h1',
          '[data-testid="communications-truth-note"]',
          '[data-testid="communications-provider-unifonic"] p',
          '[data-testid="communications-provider-unifonic"] span.text-warning',
          '[data-testid="communications-provider-twilio-sms"] span.text-muted',
          '[data-testid="communications-provider-whatsapp-business-platform"] span.bg-primary-soft',
          '[data-testid="communications-provider-amazon-ses"] span.border',
          '[data-testid="communications-boundary"]',
          '[data-testid="communications-logo-note"]',
        ]) {
          const ratio = await contrast(page, sel);
          expect(ratio, `${sel} contrast`).not.toBeNull();
          expect(ratio!, `${sel} contrast ${ratio}`).toBeGreaterThanOrEqual(4.5);
        }

        await shot(page, `${info.project.name}-comms-${locale}-${theme}`);
      });

      test('the landing card enters the catalog and the breadcrumb returns', async ({ page }) => {
        await open(page, { scenario: 'allowed', locale, theme });
        await page.getByTestId('integration-card-communications').click();
        await expect(page).toHaveURL(/\/integrations\/communications$/);
        await expect(page.getByTestId('communications-catalog')).toBeVisible();
        await page.getByTestId('integration-breadcrumb').locator('a[href="/integrations"]').click();
        await expect(page).toHaveURL(/\/integrations$/);
      });
    });
  }
}

test('communications catalog: a user without company.manage gets the denial and no provider', async ({ page }) => {
  await openCommunications(page, { locale: 'en', theme: 'light', role: 'custom', permissions: ['invoices.view'] });
  await expect(page.getByTestId('communications-restricted')).toBeVisible();
  expect(await page.locator('[data-testid^="communications-provider-"]').count()).toBe(0);
});
