import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * FUEL-PRICES #2011 — إدارة أسعار الوقود في متصفح حقيقي (آيفون 390×844 + سطح مكتب)، عربي RTL / إنجليزي LTR، فاتح/داكن.
 * الخادم مُعترَض بالكامل ببيانات اصطناعية (لا محطة ولا سعر حقيقي). اللقطات تُكتب فقط حين يُضبط `FP_SHOTS`.
 * يتحقق من: الاتجاه، عدم تجاوز العرض، أهداف اللمس ≥ 44px، خط الحقل ≥ 16px (لا تكبير iOS)، أرقام 0–9، وأن الحفظ يمرّ
 * بمراجعة وتأكيد وطلب POST واحد بمفتاح تكرار وبلا ساعة عميل.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const shots = process.env.FP_SHOTS;

const stations = [
  { id: 'sa', code: 'ST-A', name: 'Harbor Station', status: 'active', timezone: 'Asia/Riyadh' },
  { id: 'sb', code: 'ST-B', name: 'Ridge Station', status: 'active', timezone: 'Asia/Riyadh' },
];
const products = [
  { id: 'p1', code: 'P1', name: 'Alpha Grade', is_active: true },
  { id: 'p2', code: 'P2', name: 'Beta Grade', is_active: true },
  { id: 'p3', code: 'P3', name: 'Delta Grade', is_active: true },
];
const nozzles = [
  { id: 'n1', fuel_station_id: 'sa', fuel_product_id: 'p1', status: 'active' },
  { id: 'n2', fuel_station_id: 'sa', fuel_product_id: 'p2', status: 'active' },
  { id: 'n3', fuel_station_id: 'sa', fuel_product_id: 'p3', status: 'active' },
  { id: 'n4', fuel_station_id: 'sb', fuel_product_id: 'p1', status: 'active' },
];

const eff = (station: string | null, product: string, minor: number, over: Record<string, unknown> = {}) => ({
  fuel_product_id: product, fuel_station_id: station, status: 'effective', source: station ? 'station_override' : 'tenant_default', price_per_liter_minor: minor,
  unit: 'L', tax_mode: 'tax_inclusive', effective_from: '2026-10-01T09:00:00+00:00', effective_until: null, sellable: true, blockers: [], ...over,
});
const unset = (station: string | null, product: string) => ({
  fuel_product_id: product, fuel_station_id: station, status: 'not_configured', source: null, price_per_liter_minor: null, unit: 'L', tax_mode: 'tax_inclusive',
  effective_from: null, effective_until: null, sellable: false, blockers: ['price_not_configured'],
});
const sug = (station: string | null, product: string, minor: number | null, blockers: string[] = []) => ({
  fuel_product_id: product, fuel_station_id: station, status: minor ? 'available' : 'blocked', price_per_liter_minor: minor, unit: 'L', card_unit_name: minor ? 'L' : null,
  tax_mode: 'tax_inclusive', blockers, current_scope_price_minor: null, matches_current: false,
});
const hist = (id: string, minor: number, over: Record<string, unknown> = {}) => ({
  id, fuel_station_id: 'sa', fuel_product_id: 'p1', price_per_liter_minor: minor, effective_from: '2026-09-01T00:00:00+00:00', effective_until: null, status: 'active', reason: null, entry_source: 'manual', ...over,
});

interface Options { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[]; branchIds?: string[]; failEffective?: number }

async function open(page: Page, path: string, opts: Options = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = {
    id: 'me', name: 'Sami', email: 'sami@acme.test', tenant_id: 't1', role: 'manager', branch_ids: opts.branchIds ?? [], warehouse_ids: [],
    permissions: opts.permissions ?? ['fuel_stations.view', 'fuel.sale.view', 'fuel.sale.price.manage'],
  };
  let stationAlphaPrice = 218;
  let saved = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = route.request().method();
    const body = method === 'POST' ? route.request().postDataJSON() : null;
    requests.push({ method, path: p, body });
    const station = url.searchParams.get('station_id');
    if (p === '/me') return json(route, { user, company: { name: 'Acme Fuel' } });
    if (p === '/company') return json(route, { data: { name: 'Acme Fuel', logo: null } });
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/fuel-stations/stations') return json(route, { data: stations });
    if (p === '/fuel-stations/products') return json(route, { data: products });
    if (p === '/fuel-stations/nozzles') return json(route, { data: nozzles });
    if (p === '/fuel-stations/prices/effective') {
      if (opts.failEffective) return json(route, { message: 'boom' }, opts.failEffective);
      if (station === 'sb') return json(route, { data: [eff(null, 'p1', 205, { fuel_station_id: 'sb' }), unset('sb', 'p2'), unset('sb', 'p3')] });
      if (!station) return json(route, { data: [eff(null, 'p1', 205), unset(null, 'p2'), unset(null, 'p3')] });
      return json(route, { data: [eff('sa', 'p1', stationAlphaPrice, saved ? { effective_from: new Date().toISOString() } : {}), unset('sa', 'p2'), eff('sa', 'p3', 199, { tax_mode: null, sellable: false, blockers: ['tax_mode_unset'] })] });
    }
    if (p === '/fuel-stations/prices/suggestions') return json(route, { data: station === 'sa' ? [sug('sa', 'p1', 230), sug('sa', 'p2', null, ['requires_liter_price']), sug('sa', 'p3', null, ['tax_mode_unset'])] : [] });
    if (p === '/fuel-stations/prices' && method === 'POST') {
      saved = true;
      stationAlphaPrice = (body as { price_per_liter_minor: number }).price_per_liter_minor;
      return json(route, { data: hist('new', stationAlphaPrice), meta: { replayed: false, superseded_price_ids: ['old'] } }, 201);
    }
    if (p === '/fuel-stations/prices') {
      const page2 = Number(url.searchParams.get('page') ?? 1);
      return json(route, { data: page2 === 1 ? [hist('h3', stationAlphaPrice), hist('h2', 210, { effective_from: '2026-08-01T00:00:00+00:00', effective_until: '2026-10-01T09:00:00+00:00', entry_source: 'product_card' })] : [hist('h1', 199, { effective_from: '2026-06-01T00:00:00+00:00', effective_until: '2026-08-01T00:00:00+00:00' })], meta: { current_page: page2, last_page: 2 } });
    }
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  return requests;
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const L = (locale: 'ar' | 'en', ar: string, en: string) => (locale === 'ar' ? ar : en);
const shot = async (page: Page, name: string, info: { project: { name: string } }, fullPage = true) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}-${info.project.name}.png`, fullPage });
};

for (const locale of ['ar', 'en'] as const) {
  test.describe(`Fuel prices — ${locale}`, () => {
    test('board: direction, Latin digits, source/VAT/date, not-set is never zero, suggestion box, no overflow', async ({ page }, info) => {
      await open(page, '/fuel-stations/prices', { locale });
      const alpha = page.getByRole('heading', { name: 'Alpha Grade' }).locator('xpath=ancestor::li');
      await expect(alpha.getByText(/2\.18/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(await noHorizontalOverflow(page)).toBe(true);
      await expect(alpha.getByText(L(locale, 'سعر المحطة', 'Station price'))).toBeVisible();
      await expect(alpha.getByText(L(locale, 'شامل الضريبة', 'VAT included'))).toBeVisible();
      await expect(alpha.getByText(/2\.30/)).toBeVisible(); // اقتراح بطاقة المنتج
      const beta = page.getByRole('heading', { name: 'Beta Grade' }).locator('xpath=ancestor::li');
      await expect(beta.getByText(L(locale, 'السعر غير مضبوط', 'Price not set'))).toBeVisible();
      await expect(beta.getByText(L(locale, 'يتطلب تحديد سعر اللتر', 'A per-liter price must be set'))).toBeVisible();
      expect(await page.locator('main').innerText()).not.toMatch(/[٠-٩]/);
      expect(await page.locator('main').innerText()).not.toMatch(/\b0\.00\b/);
      await shot(page, `board-${locale}`, info);
    });

    test('touch targets ≥ 44px and the station select is ≥ 16px (no iOS zoom)', async ({ page }) => {
      await open(page, '/fuel-stations/prices', { locale });
      await page.getByRole('heading', { name: 'Alpha Grade' }).waitFor();
      const targets = page.locator('main button, main select');
      const count = await targets.count();
      expect(count).toBeGreaterThan(4);
      for (let i = 0; i < count; i += 1) {
        const box = await targets.nth(i).boundingBox();
        if (box) expect(box.height, `target ${i}`).toBeGreaterThanOrEqual(43.5);
      }
      const size = await page.locator('#fp-station').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
    });

    test('setting a price: form → review → one POST with an idempotency key and no client clock', async ({ page }, info) => {
      const requests = await open(page, '/fuel-stations/prices', { locale });
      const beta = page.getByRole('heading', { name: 'Beta Grade' }).locator('xpath=ancestor::li');
      await beta.getByRole('button', { name: L(locale, 'ضبط السعر', 'Set price') }).click();
      const dialog = page.getByRole('dialog');
      const input = dialog.getByLabel(L(locale, 'سعر اللتر', 'Price per liter'));
      expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      expect(await input.getAttribute('dir')).toBe('ltr');
      await shot(page, `sheet-form-empty-${locale}`, info, false);
      await input.fill('2.18');
      await shot(page, `sheet-form-filled-${locale}`, info, false);
      await dialog.getByRole('button', { name: L(locale, 'مراجعة', 'Review') }).click();
      await expect(dialog.getByText(L(locale, 'راجع قبل الحفظ', 'Review before saving'))).toBeVisible();
      await shot(page, `sheet-review-${locale}`, info, false);
      await dialog.getByRole('button', { name: L(locale, 'تأكيد وحفظ السعر', 'Confirm and save price') }).click();
      await expect(page.getByText(L(locale, 'حُفظ السعر', 'Price saved'))).toBeVisible();
      const posts = requests.filter((r) => r.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toMatchObject({ fuel_station_id: 'sa', fuel_product_id: 'p2', price_per_liter_minor: 218, start_now: true });
      expect((posts[0].body as { idempotency_key: string }).idempotency_key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      expect(posts[0].body).not.toHaveProperty('effective_from');
    });

    test('replacing a price shows the closing notice and requires acknowledgement', async ({ page }, info) => {
      await open(page, '/fuel-stations/prices', { locale });
      const alpha = page.getByRole('heading', { name: 'Alpha Grade' }).locator('xpath=ancestor::li');
      await alpha.getByRole('button', { name: L(locale, 'تعديل السعر', 'Change price') }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(L(locale, 'سعر اللتر', 'Price per liter')).fill('2.30');
      await dialog.getByRole('button', { name: L(locale, 'مراجعة', 'Review') }).click();
      await expect(dialog.getByText(L(locale, 'سيُغلق السعر الحالي', 'The current price will be closed'))).toBeVisible();
      await expect(dialog.getByRole('button', { name: L(locale, 'تأكيد وحفظ السعر', 'Confirm and save price') })).toBeDisabled();
      await shot(page, `sheet-replace-${locale}`, info, false);
      await dialog.getByRole('checkbox').check();
      await expect(dialog.getByRole('button', { name: L(locale, 'تأكيد وحفظ السعر', 'Confirm and save price') })).toBeEnabled();
    });

    test('suggestion from the product card: locked price, two acknowledgements, source sent', async ({ page }, info) => {
      const requests = await open(page, '/fuel-stations/prices', { locale });
      const alpha = page.getByRole('heading', { name: 'Alpha Grade' }).locator('xpath=ancestor::li');
      await alpha.getByRole('button', { name: L(locale, 'مراجعة الاقتراح', 'Review suggestion') }).click();
      const dialog = page.getByRole('dialog');
      const input = dialog.getByLabel(L(locale, 'سعر اللتر', 'Price per liter'));
      expect(await input.inputValue()).toBe('2.30');
      expect(await input.getAttribute('readonly')).not.toBeNull();
      await dialog.getByRole('button', { name: L(locale, 'مراجعة', 'Review') }).click();
      const approve = dialog.getByRole('button', { name: L(locale, 'اعتماد السعر', 'Approve price') });
      await expect(approve).toBeDisabled();
      await shot(page, `sheet-suggestion-${locale}`, info, false);
      for (const box of await dialog.getByRole('checkbox').all()) await box.check();
      await approve.click();
      await expect(page.getByText(L(locale, 'حُفظ السعر', 'Price saved'))).toBeVisible();
      const post = requests.find((r) => r.method === 'POST');
      expect(post?.body).toMatchObject({ price_per_liter_minor: 230, source: { type: 'product_card', confirm_tax_mode: 'tax_inclusive', confirm_unit: 'L' } });
    });

    test('history sheet pages without overflow', async ({ page }, info) => {
      await open(page, '/fuel-stations/prices', { locale });
      const alpha = page.getByRole('heading', { name: 'Alpha Grade' }).locator('xpath=ancestor::li');
      await alpha.getByRole('button', { name: L(locale, 'سجل الأسعار', 'Price history') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(L(locale, 'من بطاقة المنتج', 'From product card'))).toBeVisible();
      await shot(page, `history-${locale}`, info, false);
      await dialog.getByRole('button', { name: L(locale, 'عرض المزيد', 'Show more') }).click();
      await expect(dialog.getByText(/1\.99/)).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);
    });
  });
}

test.describe('states and themes', () => {
  test('organization scope, read-only user, forbidden, server error, dark theme', async ({ page }, info) => {
    await open(page, '/fuel-stations/prices', { locale: 'ar', theme: 'dark' });
    await expect(page.getByRole('heading', { name: 'Alpha Grade' })).toBeVisible();
    await shot(page, 'board-dark-ar', info);
    await page.getByRole('radio', { name: 'المؤسسة' }).click();
    await expect(page.getByText(/2\.05/)).toBeVisible();
    await shot(page, 'org-scope-dark-ar', info);
  });

  test('read-only permissions hide every write control', async ({ page }, info) => {
    const requests = await open(page, '/fuel-stations/prices', { locale: 'en', permissions: ['fuel_stations.view', 'fuel.sale.view'] });
    await expect(page.getByRole('heading', { name: 'Alpha Grade' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Change price|Set price/ })).toHaveCount(0);
    expect(requests.filter((r) => r.path.includes('/suggestions'))).toHaveLength(0);
    await shot(page, 'board-readonly-en', info);
  });

  test('without sale-view permission: the permission state, no price requests', async ({ page }, info) => {
    const requests = await open(page, '/fuel-stations/prices', { locale: 'ar', permissions: ['fuel_stations.view'] });
    await expect(page.getByText('غير متاح لصلاحياتك')).toBeVisible();
    expect(requests.filter((r) => r.path.startsWith('/fuel-stations/prices'))).toHaveLength(0);
    await shot(page, 'forbidden-ar', info);
  });

  test('server error shows its own state with retry and no number', async ({ page }, info) => {
    await open(page, '/fuel-stations/prices', { locale: 'ar', failEffective: 500 });
    await expect(page.getByText('تعذّر تحميل الأسعار')).toBeVisible();
    await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(/\d+\.\d{2}/);
    await shot(page, 'error-ar', info);
  });
});
