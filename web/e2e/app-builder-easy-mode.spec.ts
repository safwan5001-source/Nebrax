import { expect, test, type Page, type Route } from '@playwright/test';
import { auditPage } from './helpers/a11y-audit';

/**
 * AWJ App Builder — الوضع السهل V2 (S21a/S23) في متصفح حقيقي.
 *
 * يتحقق من: يفتح المحرر على الوضع السهل بالمعاينة وقائمة الأقسام، بلا تمرير أفقي عند 390/768/1100/1440 (عربي RTL وإنجليزي)،
 * وكل زر مرئي له اسم وصول، ولا أخطاء Console، وأن إضافة قسم من الكتالوج وحفظه يرسل `base_revision` ومعرّفات فريدة، وأن
 * المقترح لا يُضاف. الخادم مُعترَض بالكامل (لا خلفية). `APP_BUILDER_SHOTS=<dir>` يحفظ لقطات الشاشة للمراجعة البصرية.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.APP_BUILDER_SHOTS;
const APP_ID = '11111111-1111-4111-8111-111111111111';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;

const draftSchema = () => ({
  schemaVersion: '1.0.0',
  minRuntimeVersion: '1.0.0',
  requiredCapabilities: {},
  theme: { tokens: { primaryColor: '#0f766e' } },
  navigation: { initialPageId: 'home' },
  pages: {
    home: {
      type: 'Page', id: 'home-root',
      children: [
        { type: 'Section', id: 'sec-welcome', props: { title: 'مرحباً' }, children: [{ type: 'Text', id: 'txt-welcome', props: { text: 'أهلاً بك في متجرنا', style: 'title' } }] },
        { type: 'Section', id: 'sec-products', props: { title: 'الأكثر طلباً' }, children: [{ type: 'ProductList', id: 'pl-1', binding: { resource: 'commerce.products' }, children: [{ type: 'ProductCard', id: 'pc-1', optional: true, props: { title: '$item.display_name', amountMinor: '$item.price.amount_minor' }, action: { type: 'openProduct', params: { productId: '$item.id' } } }] }] },
        { type: 'Section', id: 'sec-cta', children: [{ type: 'Button', id: 'btn-cta', props: { label: 'تسوّق الآن', style: 'primary' }, action: { type: 'navigate', params: { pageId: 'cart' } } }] },
      ],
    },
    cart: { type: 'Page', id: 'cart-root', children: [{ type: 'CartSummary', id: 'cs-1', props: { itemCount: 0, subtotalAmountMinor: 0 } }] },
  },
});

const label = (ar: string, en: string) => ({ ar, en });
const prop = (key: string, type: string, required: boolean, ar: string, en: string, def: unknown = null, enumValues: string[] | null = null) =>
  ({ key, type, required, label: label(ar, en), default: def, enum_values: enumValues });
const comp = (type: string, ar: string, en: string, props: unknown[], container: boolean, actionable = false) => ({
  type, version: 1, category: container ? 'layout' : 'content', label: label(ar, en), props,
  children_rule: { kind: container ? 'unboundedAny' : 'none', suggested_child_type: null }, actionable,
  injected_runtime_action_params: [], notes: type, bindable_resources: type === 'ProductList' ? ['commerce.products'] : [],
  allowed_children: container ? ['Section', 'Text', 'Button', 'ProductList', 'ProductCard', 'CartSummary'] : [],
  allowed_parents: type === 'Page' ? [] : ['Page', 'Section'],
});
const registries = {
  components: {
    Page: comp('Page', 'الصفحة', 'Page', [], true),
    Section: comp('Section', 'قسم', 'Section', [prop('title', 'string', false, 'العنوان', 'Title')], true),
    Text: comp('Text', 'نص', 'Text', [prop('text', 'string', false, 'النص', 'Text', ''), prop('style', 'string', false, 'الأسلوب', 'Style', 'body', ['title', 'body', 'caption'])], false),
    Button: comp('Button', 'زر', 'Button', [prop('label', 'string', false, 'التسمية', 'Label', 'زر')], false, true),
    ProductList: comp('ProductList', 'قائمة المنتجات', 'Product list', [], true),
    ProductCard: comp('ProductCard', 'بطاقة منتج', 'Product card', [prop('title', 'string', true, 'العنوان', 'Title', '')], false, true),
    CartSummary: comp('CartSummary', 'ملخص السلة', 'Cart summary', [], false),
  },
  actions: {
    navigate: { type: 'navigate', version: 1, risk_class: 'navigation', label: label('الانتقال', 'Navigate'), params: [{ key: 'pageId', type: 'string', required: true, label: label('الصفحة', 'Page'), nullable: false, default: null, min_value: null }], dispatch_status: 'provenNoop', notes: '' },
    openProduct: { type: 'openProduct', version: 1, risk_class: 'navigation', label: label('فتح المنتج', 'Open product'), params: [{ key: 'productId', type: 'string', required: true, label: label('المنتج', 'Product'), nullable: false, default: null, min_value: null }], dispatch_status: 'live', notes: '' },
  },
  resources: {}, visibility_signals: [], visibility_operators: [],
};

interface Opts { locale: 'ar' | 'en'; viewport: (typeof VIEWPORTS)[number]; permissions?: string[] }

async function open(page: Page, opts: Opts) {
  const puts: Array<{ schema: ReturnType<typeof draftSchema>; base_revision?: number; editor_meta?: unknown }> = [];
  let storedMeta: unknown = null; // يحاكي حفظ الخادم لبيانات المحرر (AD-05)
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.setViewportSize(opts.viewport);
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'] };
  let revision = 0;

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    if (path === '/app-builder/registries') return json(route, { data: registries });
    if (path === `/app-builder/apps/${APP_ID}/draft`) {
      if (method === 'PUT') {
        const body = route.request().postDataJSON();
        puts.push(body);
        storedMeta = body.editor_meta ?? null;
        revision += 1;
        return json(route, { data: { id: 'd1', builder_app_id: APP_ID, schema: body.schema, editor_meta: storedMeta, revision, updated_at: new Date().toISOString() }, issues: [] });
      }
      return json(route, { data: { id: 'd1', builder_app_id: APP_ID, schema: draftSchema(), editor_meta: storedMeta, revision, updated_at: new Date().toISOString() }, issues: [] });
    }
    if (path === `/app-builder/apps/${APP_ID}`) return json(route, { data: { id: APP_ID, name: 'متجر الأفق', name_en: 'Horizon Store', creation_source: 'scratch', latest_published_version: null, created_at: '2026-10-01', updated_at: '2026-10-01' } });
    if (path.startsWith('/commerce/workspace')) return json(route, { data: [] });
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', 'light');
  }, [JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/app-builder/${APP_ID}/builder`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await expect(page.getByTestId('easy-sections').and(page.locator(':visible')).first()).toBeVisible({ timeout: 20_000 });
  return { puts, consoleErrors };
}

const visibleSections = (page: Page) => page.getByTestId('easy-sections').and(page.locator(':visible')).first();

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};

async function unnamedButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    return Array.from(document.querySelectorAll('button, [role=button], a[href]'))
      .filter(visible)
      .filter((el) => !(el.getAttribute('aria-label')?.trim() || el.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('title')?.trim()))
      .map((el) => el.outerHTML.slice(0, 120));
  });
}

test.describe('App Builder — Easy Mode V2 (real browser)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'الأحجام تُضبط داخل الاختبار');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const viewport of VIEWPORTS) {
      test(`opens in Easy mode with sections + preview, no horizontal scroll, named controls, no console errors — ${locale} ${viewport.width}px`, async ({ page }) => {
        const { consoleErrors } = await open(page, { locale, viewport });

        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
        await expect(page.getByRole('button', { pressed: true }).filter({ hasText: locale === 'ar' ? 'سهل' : 'Easy' }).first()).toBeVisible();
        expect(await page.getByTestId('easy-sections').count()).toBeGreaterThan(0);
        await noHorizontalOverflow(page);
        expect(await unnamedButtons(page)).toEqual([]);
        if (shots) await page.screenshot({ path: `${shots}/easy-${locale}-${viewport.width}.png`, fullPage: false });
        // INVALID_KEY: مفاتيح ترجمة تحوي نقطة (visibility.signalOption.cart.itemCount, developer.events.*) — عيب قائم قبل الوضع السهل ومسجَّل (UX-I18N-DOT)
        expect(consoleErrors.filter((e) => !/favicon|Failed to load resource|ERR_|net::|INVALID_KEY/.test(e))).toEqual([]);
      });
    }
  }

  test('add a ready section from the catalog, then save: base_revision is sent and every id is unique; a proposed section cannot be added', async ({ page }) => {
    const { puts } = await open(page, { locale: 'en', viewport: VIEWPORTS[0] });

    await visibleSections(page).getByRole('button', { name: 'Add section' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const slider = dialog.locator('li', { hasText: 'Slider' }).first();
    await expect(slider.getByRole('button')).toBeDisabled();
    if (shots) await page.screenshot({ path: `${shots}/easy-en-catalog.png` });

    await dialog.locator('li', { hasText: 'Text' }).first().getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect.poll(() => puts.length).toBe(1);

    expect(puts[0].base_revision).toBe(0);
    const ids: string[] = [];
    const walk = (n: { id: string; children?: unknown[] }) => { ids.push(n.id); (n.children as typeof n[] | undefined)?.forEach(walk); };
    Object.values(puts[0].schema.pages).forEach((root) => walk(root as { id: string; children?: unknown[] }));
    expect(new Set(ids).size).toBe(ids.length);
    expect(puts[0].schema.pages.home.children.length).toBe(4);
  });

  test('hide + rename a section and a page title: the preview drops the hidden section, save sends editor_meta (schema untouched), and a reload restores it', async ({ page }) => {
    const { puts } = await open(page, { locale: 'en', viewport: VIEWPORTS[0] });
    const list = visibleSections(page);
    await expect(page.getByText('أهلاً بك في متجرنا').first()).toBeVisible();

    await list.getByRole('listitem').first().getByRole('button', { name: 'Rename section' }).click();
    await page.getByRole('textbox', { name: 'New section name' }).fill('Welcome banner');
    await page.keyboard.press('Enter');
    await list.getByRole('listitem').first().getByRole('button', { name: 'Hide section' }).click();
    await expect(page.getByText('أهلاً بك في متجرنا')).toHaveCount(0);
    await expect(list.getByRole('listitem').first().getByText('Hidden')).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/easy-en-hidden.png` });

    await list.getByRole('button', { name: 'Page title' }).click();
    await page.getByRole('textbox', { name: 'Page title' }).fill('Landing');
    await page.keyboard.press('Enter');

    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].editor_meta).toEqual({ v: 1, nodes: { home: { 'sec-welcome': { name: 'Welcome banner', hidden: true } } }, pages: { home: { title: 'Landing' } } });
    expect(puts[0].schema.pages.home.children.map((c: { id: string }) => c.id)).toEqual(['sec-welcome', 'sec-products', 'sec-cta']);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(visibleSections(page)).toBeVisible({ timeout: 20_000 });
    await expect(visibleSections(page).getByText('Welcome banner')).toBeVisible();
    await expect(page.getByText('أهلاً بك في متجرنا')).toHaveCount(0);
  });

  test('Easy mode page management: delete asks first and names the actions that point to it; making a page home is what is saved', async ({ page }) => {
    const { puts } = await open(page, { locale: 'en', viewport: VIEWPORTS[0] });
    const list = visibleSections(page);
    await page.getByRole('button', { name: /^cart/ }).first().click();

    await page.getByRole('button', { name: 'Delete this page' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('1 action that navigates');
    await dialog.getByRole('button', { name: 'Keep page' }).click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);

    await page.getByRole('button', { name: 'Make this the home page' }).first().click();
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect.poll(() => puts.length).toBe(1);
    expect((puts[0].schema as unknown as { navigation: { initialPageId: string } }).navigation.initialPageId).toBe('cart');
    await expect(list).toBeVisible();
  });

  test('selecting an element in the preview shows the section toolbar; Advanced shows the layers tree and switching back keeps the draft', async ({ page }) => {
    await open(page, { locale: 'en', viewport: VIEWPORTS[0] });
    await visibleSections(page).getByRole('listitem').first().getByRole('button').first().click();
    await expect(page.getByTestId('easy-selection-bar')).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/easy-en-selected.png` });

    await page.getByRole('button', { name: 'Advanced' }).click();
    await expect(page.getByRole('tree').first()).toBeVisible();
    await page.getByRole('button', { name: 'Easy' }).click();
    await expect(visibleSections(page)).toBeVisible();
  });

  for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
    test(`a11y/structure audit (named controls, labels, ids, 24px targets) on Easy mode and on Advanced with a node selected — ${viewport.width}px`, async ({ page }) => {
      await open(page, { locale: 'en', viewport });
      const easy = await auditPage(page);
      await visibleSections(page).getByRole('listitem').first().getByRole('button').first().click();
      const easySelected = await auditPage(page);
      await page.getByRole('button', { name: 'Advanced' }).click();
      const advanced = await auditPage(page);
      if (process.env.APP_BUILDER_AUDIT_DUMP) console.log(JSON.stringify({ viewport: viewport.width, easy, easySelected, advanced }, null, 1));
      expect({ easy, easySelected, advanced }).toEqual({ easy: [], easySelected: [], advanced: [] });
    });
  }

  // UX-09/10 — جوال أفقي وآيباد عمودي: المعاينة والأدوات معاً دون حجب (لقطات + حدود هندسية للمعاينة).
  for (const viewport of [{ width: 844, height: 390 }, { width: 834, height: 1194 }, { width: 744, height: 1133 }] as const) {
    test(`preview stays usable next to the tools — ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await open(page, { locale: 'en', viewport: viewport as unknown as (typeof VIEWPORTS)[number] });
      await noHorizontalOverflow(page);
      if (shots) await page.screenshot({ path: `${shots}/easy-en-${viewport.width}x${viewport.height}.png` });
      const canvasBox = await page.getByText('Draft — being edited, not a live version in the mobile app').first().boundingBox();
      expect(canvasBox).not.toBeNull();
      // المعاينة تبدأ فوق الطيّ ويبقى منها جزء ظاهر فعلي
      expect(canvasBox!.y).toBeLessThan(viewport.height * 0.6);
    });
  }

  test.describe('touch (pointer: coarse)', () => {
    test.use({ hasTouch: true, isMobile: true });

    // UX-04: على اللمس كل عنصر تفاعلي مرئي ≥ 44×44 (الكثافة على المؤشر الدقيق لا تتغير).
    for (const viewport of [{ width: 390, height: 844 }, { width: 834, height: 1194 }] as const) {
      test(`interactive controls are at least 44px on touch — ${viewport.width}px`, async ({ page }) => {
        await open(page, { locale: 'en', viewport: viewport as unknown as (typeof VIEWPORTS)[number] });
        const small = await page.evaluate(() => {
          const visible = (el: Element) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('[aria-hidden="true"],nextjs-portal,[data-preview-surface]'); };
          return Array.from(document.querySelectorAll('button, [role=button], a[href], input:not([type=hidden]), select, textarea'))
            .filter(visible)
            .map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) }; })
            .filter((x) => x.w < 44 || x.h < 44);
        });
        if (process.env.APP_BUILDER_AUDIT_DUMP) console.log(JSON.stringify(small));
        expect(small).toEqual([]);
      });
    }
  });
});
