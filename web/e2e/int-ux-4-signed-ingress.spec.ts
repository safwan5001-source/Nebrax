import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * INT-UX-4 — التحقق البصري والسلوكي للوحة نقاط الاستقبال الموقّعة (قراءة فقط) في متصفح حقيقي.
 *
 * يعمل ضد خادم الواجهة فقط: كل طلب `/api/*` يُعترَض ويُجاب ببيانات محكومة (لا خلفية ولا مزوّد). تحمل
 * بيانات الاختبار قيماً «حارسة» (SENTINEL_*) في الحقول التي لا يجوز أن تصل إلى الشاشة (بادئة السرّ، المفاتيح،
 * معرّفات المشغّلين والنقطة)، ويُثبت الاختبار غيابها من DOM الفعلي. اللقطات تُكتب فقط حين يُضبط `INT_UX4_SHOTS`
 * (مجلد خارج المستودع) — وهي لا تحمل أي قيمة سرّية لأن الواجهة لا تستلمها أصلاً.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.INT_UX4_SHOTS;

type Scenario = 'ready' | 'empty' | 'error' | 'forbidden' | 'malformed' | 'slow' | 'app_off' | 'many';
type Viewer = 'owner' | 'connector' | 'accountant';
type Requests = string[];

const SENTINELS = ['SENTINEL_PREFIX', 'SENTINEL_SECRET', 'SENTINEL_TOKEN', 'SENTINEL_KEY', 'SENTINEL_OPERATOR', 'SENTINEL_ACCOUNT', 'SENTINEL_PROFILE'];

const SIX = ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz'];

const account = (over: Record<string, unknown> = {}) => ({
  id: 'SENTINEL_ACCOUNT_1',
  delivery_platform_profile_id: 'SENTINEL_PROFILE_1',
  platform_key: 'keeta',
  external_store_id: 'KTA-RIYADH-0042',
  branch_id: 'br-1',
  configured_by: 'SENTINEL_OPERATOR_1',
  operated_by: 'SENTINEL_OPERATOR_2',
  status: 'configured',
  secret_prefix: 'SENTINEL_PREFIX_x9',
  secret_version: 3,
  disabled_at: null,
  created_at: '2026-10-01T08:00:00Z',
  secret: 'SENTINEL_SECRET',
  token: 'SENTINEL_TOKEN',
  signing_key: 'SENTINEL_KEY',
  ...over,
});

function connectors(scenario: Scenario) {
  if (scenario === 'empty') return { data: [account({ platform_key: 'jahez' })] };
  if (scenario === 'malformed') return { data: [account({ status: 'weird' })] };
  const rows = [
    account(),
    account({ id: 'SENTINEL_ACCOUNT_2', external_store_id: 'KTA-KHOBAR-0107', branch_id: 'br-2', status: 'disabled', disabled_at: '2026-10-05T00:00:00Z', secret_version: 1 }),
    account({ id: 'SENTINEL_ACCOUNT_3', external_store_id: 'KTA-UNROUTED', branch_id: null }),
    account({ id: 'SENTINEL_ACCOUNT_4', platform_key: 'jahez', external_store_id: 'OTHER-PLATFORM-STORE' }),
  ];
  if (scenario === 'many') {
    for (let i = 0; i < 12; i += 1) rows.push(account({ id: `SENTINEL_ACCOUNT_M${i}`, external_store_id: `KTA-BULK-STORE-WITH-A-VERY-LONG-IDENTIFIER-${i}`, branch_id: 'br-1' }));
  }
  return { data: rows };
}

async function mockApi(page: Page, scenario: Scenario, requests: Requests) {
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push(`${route.request().method()} ${path}`);
    if (route.request().method() !== 'GET') return json(route, { data: [] });
    if (path === '/applications/nav-state') return json(route, { data: { 'sales.pos': scenario !== 'app_off' } });
    if (path === '/delivery-platforms/readiness') {
      return json(route, { data: SIX.map((platform_key) => ({ platform_key, ux_state: 'NOT_SUPPORTED', connect_enabled: false, sync_enabled: false })) });
    }
    if (path === '/delivery-platforms') return json(route, { data: [{ id: 'p1', platform_key: 'keeta', is_active: true }] });
    if (path === '/delivery-connectors') {
      if (scenario === 'error') return json(route, { message: 'down' }, 500);
      if (scenario === 'forbidden') return json(route, { message: 'forbidden' }, 403);
      if (scenario === 'slow') await new Promise((resolve) => setTimeout(resolve, 2500));
      return json(route, connectors(scenario));
    }
    if (path === '/branches') return json(route, { data: [{ id: 'br-1', name: 'فرع الدمام' , code: 'DMM' }, { id: 'br-2', name: 'فرع الخبر' }] });
    if (path === '/me') return json(route, { user: { id: 'u1', name: 'المالك', role: 'owner', permissions: ['*'] }, company: { name: 'نبراس الطموح' } });
    return json(route, { data: [] });
  });
}

const VIEWERS = {
  owner: { role: 'owner', permissions: ['*'] },
  connector: { role: 'custom', permissions: ['invoices.view', 'delivery_connector.view'] },
  accountant: { role: 'accountant', permissions: ['invoices.view', 'reports.view', 'branches.view'] },
} as const;

async function open(page: Page, opts: { scenario?: Scenario; locale: 'ar' | 'en'; theme: 'light' | 'dark'; viewer?: Viewer }) {
  const requests: Requests = [];
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  await mockApi(page, opts.scenario ?? 'ready', requests);
  const user = { id: 'u1', name: 'المالك', email: 'o@test', tenant_id: 't1', ...VIEWERS[opts.viewer ?? 'owner'] };
  await page.addInitScript(([theme, userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [opts.theme, JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/integrations/delivery-platforms/keeta`, { waitUntil: 'domcontentloaded' });
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
      test('ready: rows, one layout per viewport, no secret in the DOM, only create/rotate/disable actions, AA contrast', async ({ page }, info) => {
        const requests = await open(page, { locale, theme });
        const panel = page.getByTestId('signed-ingress-panel');
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute('data-state', 'ready');
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);

        const mobile = info.project.name === 'mobile';
        await expect(page.getByTestId('signed-ingress-table')).toBeVisible({ visible: !mobile });
        await expect(page.getByTestId('signed-ingress-cards')).toBeVisible({ visible: mobile });
        const visibleRows = panel.locator('[data-testid="signed-ingress-row"]:visible');
        await expect(visibleRows).toHaveCount(3);
        await expect(panel).toContainText('KTA-RIYADH-0042');
        await expect(panel).toContainText('فرع الدمام');
        await expect(panel).not.toContainText('OTHER-PLATFORM-STORE');
        await expect(panel.locator('[data-testid="signed-ingress-status"]:visible').first()).toBeVisible();

        const html = await page.content();
        for (const sentinel of SENTINELS) expect(html, sentinel).not.toContain(sentinel);
        // INT-UX-5b: المالك يرى الإنشاء (ملف إسناد مفعّل) وتدوير السر والتعطيل لنقطة مهيّأة فقط (لا إعادة إسناد ولا غيره)؛ لا طلب كتابة قبل أي نقرة.
        const buttonIds = await panel.getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
        expect([...new Set(buttonIds)].sort()).toEqual(['ingress-create-open', 'ingress-disable', 'ingress-rotate']);
        expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
        // مع branches.view تُقرأ أسماء الفروع بعد قراءة النقاط (طلب اللوحة، لا طلب الغلاف).
        expect(requests.slice(requests.indexOf('GET /delivery-connectors') + 1)).toContain('GET /branches');

        // لا تمرير أفقي، والمعرّف الطويل لا يكسر التخطيط.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        for (const selector of ['#signed-ingress-heading', '[data-testid="signed-ingress-notes"] p', '[data-testid="signed-ingress-row"]:not(:empty) td, [data-testid="signed-ingress-row"] dd']) {
          const ratio = await contrast(page, selector);
          if (ratio !== null) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
        }
        const badgeRatio = await contrast(page, '[data-testid="signed-ingress-status"][data-status="configured"]');
        if (badgeRatio !== null) expect(badgeRatio).toBeGreaterThanOrEqual(4.5);
        await shot(page, `ready-${locale}-${theme}-${info.project.name}`);
      });

      test('the store id is isolated left-to-right and the connection boundary stays visible', async ({ page }) => {
        await open(page, { locale, theme });
        const panel = page.getByTestId('signed-ingress-panel');
        await expect(panel).toHaveAttribute('data-state', 'ready');
        const dirs = await panel.locator('[dir="ltr"]:visible').evaluateAll((els) => els.map((el) => el.textContent));
        expect(dirs).toEqual(expect.arrayContaining(['KTA-RIYADH-0042']));
        await expect(page.getByTestId('ingress-note')).toBeVisible();
        await expect(page.getByTestId('capability-ladder')).toBeVisible();
      });
    });
  }
}

test.describe('viewers', () => {
  test('connector-only viewer: no /branches request, neutral branch text, no branch name or id anywhere', async ({ page }) => {
    const requests = await open(page, { locale: 'ar', theme: 'light', viewer: 'connector' });
    const panel = page.getByTestId('signed-ingress-panel');
    await expect(panel).toHaveAttribute('data-state', 'ready');
    // الغلاف العام يقرأ /branches لمبدّل الفرع قبل اللوحة؛ ما يعنينا ألّا تطلبه اللوحة بعد قراءة النقاط.
    expect(requests.slice(requests.indexOf('GET /delivery-connectors') + 1)).not.toContain('GET /branches');
    await expect(panel).toContainText('موجّهة إلى فرع');
    // النطاق اللوحة وحدها: مبدّل الفرع في الغلاف العام (خارج هذه الشريحة) يقرأ /branches بذاته ولا يخصّ اللوحة.
    const panelHtml = await panel.innerHTML();
    expect(panelHtml).not.toContain('فرع الدمام');
    expect(panelHtml).not.toContain('br-1');
    const html = await page.content();
    for (const sentinel of SENTINELS) expect(html, sentinel).not.toContain(sentinel);
    await shot(page, `viewer-connector-only-${test.info().project.name}`);
  });

  test('accountant (no delivery_connector.view): the panel is absent and the connector list is never requested', async ({ page }) => {
    const requests = await open(page, { locale: 'en', theme: 'light', viewer: 'accountant' });
    await expect(page.getByTestId('capability-ladder')).toBeVisible();
    await expect(page.getByTestId('signed-ingress-panel')).toHaveCount(0);
    expect(requests).not.toContain('GET /delivery-connectors');
  });

  test('POS application off: restricted notice, no panel, no connector request', async ({ page }) => {
    const requests = await open(page, { scenario: 'app_off', locale: 'en', theme: 'dark' });
    await expect(page.getByTestId('integration-restricted')).toBeVisible();
    await expect(page.getByTestId('signed-ingress-panel')).toHaveCount(0);
    expect(requests).not.toContain('GET /delivery-connectors');
  });
});

test.describe('states (ar/light and en/dark)', () => {
  for (const [locale, theme] of [['ar', 'light'], ['en', 'dark']] as const) {
    test(`empty is a distinct state, not an error (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, { scenario: 'empty', locale, theme });
      await expect(page.getByTestId('signed-ingress-empty')).toBeVisible();
      await expect(page.getByTestId('signed-ingress-error')).toHaveCount(0);
      await expect(page.getByTestId('signed-ingress-panel').getByRole('table')).toHaveCount(0);
      await shot(page, `empty-${locale}-${theme}-${info.project.name}`);
    });

    test(`server error shows an alert with a keyboard-reachable retry, never empty (${locale}/${theme})`, async ({ page }, info) => {
      const requests = await open(page, { scenario: 'error', locale, theme });
      const error = page.getByTestId('signed-ingress-error');
      await expect(error).toBeVisible();
      await expect(page.getByTestId('signed-ingress-empty')).toHaveCount(0);
      const retry = error.getByRole('button');
      await expect(retry).toHaveCount(1);
      await retry.focus();
      await expect(retry).toBeFocused();
      const ring = await retry.evaluate((el) => getComputedStyle(el).boxShadow + getComputedStyle(el).outlineStyle);
      expect(ring).not.toBe('noneNone');
      const before = requests.filter((r) => r === 'GET /delivery-connectors').length;
      await page.keyboard.press('Enter');
      await expect.poll(() => requests.filter((r) => r === 'GET /delivery-connectors').length).toBeGreaterThan(before);
      await shot(page, `error-${locale}-${theme}-${info.project.name}`);
    });

    test(`403 is "not available to you", not "no ingress points" (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, { scenario: 'forbidden', locale, theme });
      await expect(page.getByTestId('signed-ingress-forbidden')).toBeVisible();
      await expect(page.getByTestId('signed-ingress-empty')).toHaveCount(0);
      await expect(page.getByTestId('signed-ingress-row')).toHaveCount(0);
      await shot(page, `forbidden-${locale}-${theme}-${info.project.name}`);
    });

    test(`a malformed payload is an error, not a partial list (${locale}/${theme})`, async ({ page }) => {
      await open(page, { scenario: 'malformed', locale, theme });
      await expect(page.getByTestId('signed-ingress-error')).toBeVisible();
      await expect(page.getByTestId('signed-ingress-row')).toHaveCount(0);
    });

    test(`loading skeleton then ready (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, { scenario: 'slow', locale, theme });
      await expect(page.getByTestId('signed-ingress-loading')).toBeVisible();
      await shot(page, `loading-${locale}-${theme}-${info.project.name}`);
      await expect(page.getByTestId('signed-ingress-panel')).toHaveAttribute('data-state', 'ready', { timeout: 10_000 });
    });

    test(`many long store ids neither overflow nor scroll the page sideways (${locale}/${theme})`, async ({ page }, info) => {
      await open(page, { scenario: 'many', locale, theme });
      await expect(page.getByTestId('signed-ingress-panel')).toHaveAttribute('data-state', 'ready');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await shot(page, `many-${locale}-${theme}-${info.project.name}`);
    });
  }
});

test('the existing INT-UX-2 ingress note and INT-UX-3 manual links are unchanged by the panel', async ({ page }) => {
  await open(page, { locale: 'en', theme: 'light' });
  await expect(page.getByTestId('signed-ingress-panel')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('ingress-note')).toBeVisible();
  await expect(page.getByTestId('works-today').getByRole('link')).toHaveCount(3);
  await expect(page.getByTestId('detail-boundaries')).toBeVisible();
});
