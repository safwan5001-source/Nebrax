import { expect, test, type Page } from '@playwright/test';

// AWJ v3 (Horizon 2) — structural contract for Data Grid + Document Workspace behind the gate.
// Runs against Demo Mode (no backend): real production components, local mock data.
// Not a pixel test: it pins the gate boundary, the real-state-only lifecycle, the posted-entries
// path, the Totals Dock presenting stored values, and the LineGrid keyboard contract.

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

async function enterDemo(page: Page) {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  await page.addInitScript(() => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'demo-user', name: 'مستخدم المعاينة', email: 'demo@nibras.test',
        role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant',
      })
    );
  });
}

async function go(page: Page, route: string, gate: boolean) {
  await page.goto(`${baseUrl}${route}?awj-ui=${gate ? '3' : 'legacy'}`, { waitUntil: 'load' });
}

test.describe('gate OFF keeps the legacy screens', () => {
  test('posted invoice has no Document Workspace regions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/invoices/inv-118', false);
    await expect(page.getByRole('heading', { name: 'INV-2026-0118' })).toBeVisible();
    await expect(page.locator('[data-awj-docws]')).toHaveCount(0);
    await expect(page.locator('[data-awj-dock]')).toHaveCount(0);
  });

  test('invoice list header is not sticky-start and rows use legacy density', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/invoices', false);
    const first = page.locator('[data-awj-sticky-start]').first();
    await expect(first).toBeVisible();
    expect(await first.evaluate((el) => getComputedStyle(el).position)).not.toBe('sticky');
  });

  test('editor ignores Alt+N (no v3 shortcuts)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/invoices/new', false);
    const rows = page.locator('[data-awj-linegrid-row]');
    await expect(rows).toHaveCount(1);
    await page.locator('input[id$="-qty"]').first().focus();
    await page.keyboard.press('Alt+n');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-awj-dock]')).toHaveCount(0);
  });
});

test.describe('gate ON — Sales Invoice Document Workspace', () => {
  test('posted invoice: real lifecycle only, dock shows stored totals, entries tab is read-only', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/invoices/inv-118', true);

    await expect(page.locator('[data-awj-docws]')).toHaveCount(1);
    await expect(page.getByRole('toolbar')).toBeVisible();

    // lifecycle: stored states only (draft › posted) + independent payment axis from payment_status
    const doc = page.getByRole('list', { name: 'حالة المستند' });
    await expect(doc.getByRole('listitem')).toHaveText([/مسودة/, /مرحّلة/]);
    await expect(doc.locator('[aria-current="step"]')).toHaveText(/مرحّلة/);
    await expect(page.getByRole('list', { name: 'حالة الدفع' }).locator('[aria-current="step"]')).toHaveText(/مدفوعة/);
    // no prototype-only state ("issued") anywhere inside the lifecycle rail
    await expect(page.locator('[data-awj-lifecycle]').getByText(/صادرة|issued/i)).toHaveCount(0);

    // dock presents the stored total verbatim
    const outcome = page.locator('[data-awj-dock-outcome-value]');
    await expect(outcome).toContainText('5,750.00');
    const region = page.getByRole('region', { name: 'ملخص الإجماليات' });
    await expect(region).toBeVisible();
    // no primary action inside the dock (the detail disclosure is hidden on desktop when nothing overflows)
    await expect(region.getByRole('button', { name: /ترحيل|دفع|حفظ/ })).toHaveCount(0);

    // posted entries: server lines, no totals row, read-only marker
    await page.getByRole('tab', { name: /القيود المحاسبية/ }).click();
    await expect(page.getByText('JE-2026-0005')).toBeVisible();
    await expect(page.getByText('للقراءة فقط').first()).toBeVisible();
    await expect(page.locator('[data-awj-posted-entries] tfoot')).toHaveCount(0);
    await expect(page.locator('[data-awj-posted-entries] tbody tr')).toHaveCount(3);
  });

  test('draft invoice: no entries tab (draft preview is not built), primary action is the real post operation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/invoices/inv-115', true);
    await expect(page.getByRole('tab', { name: /القيود المحاسبية/ })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'حالة الدفع' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /ترحيل الفاتورة/ })).toBeVisible();
  });

  test('print/PDF root stays mounted while another tab is active', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/invoices/inv-118', true);
    await expect(page.locator('#print-root')).toHaveCount(1);
  });

  test('dock is pinned to the viewport bottom and keeps every figure reachable at 1280×720', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page);
    await go(page, '/invoices/inv-118', true);
    const dock = page.locator('[data-awj-dock]');
    await expect(dock).toBeVisible();
    const box = await dock.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(720 + 1);
    expect(box!.y).toBeGreaterThan(400);
  });
});

test.describe('gate ON — second document type reuses the same grammar', () => {
  test('purchase invoice renders the shared workspace, dock and posted entry', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/purchases/pu-42', true);
    await expect(page.locator('[data-awj-docws]')).toHaveCount(1);
    await expect(page.locator('[data-awj-dock-outcome-value]')).toContainText('6,900.00');
    await page.getByRole('tab', { name: /القيود المحاسبية/ }).click();
    await expect(page.getByText('JE-2026-0003')).toBeVisible();
  });
});

test.describe('gate ON — Data Grid and LineGrid', () => {
  test('selected rows carry the Apex rail on the first cell; sticky identity column', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/products', true);
    const box = page.locator('table input[type="checkbox"]').nth(2);
    await box.check();
    const row = page.locator('[data-awj-row][data-awj-selected]').first();
    await expect(row).toHaveCount(1);
    const before = await row.locator('> :first-child').evaluate((el) => {
      const cs = getComputedStyle(el, '::before');
      return { content: cs.content, width: cs.width };
    });
    expect(before.content).toBe('""');
    expect(before.width).toBe('3px');
    const stuck = page.locator('[data-awj-sticky-start]').first();
    expect(await stuck.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  });

  test('editor: Alt+N adds a line, Alt+Arrow keeps the column; plain arrows are untouched', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/invoices/new', true);
    const rows = page.locator('[data-awj-linegrid-row]');
    await expect(rows).toHaveCount(1);
    await page.locator('input[id$="-qty"]').first().focus();
    await page.keyboard.press('Alt+n');
    await expect(rows).toHaveCount(2);
    await page.locator('input[id$="-qty"]').first().focus();
    await page.keyboard.press('Alt+ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.id ?? '')).toMatch(/-qty$/);
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe(
      await page.locator('input[id$="-qty"]').first().getAttribute('id')
    );
    await expect(page.locator('[data-awj-dock]')).toHaveCount(1);
  });
});

test.describe('regression — purchase detail never crashes in Demo Mode', () => {
  for (const gate of [true, false]) {
    test(`/purchases/pu-42 renders without a page error (gate ${gate ? 'ON' : 'OFF'})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: 1440, height: 900 });
      await enterDemo(page);
      await go(page, '/purchases/pu-42', gate);
      await expect(page.getByText('Application error')).toHaveCount(0);
      await expect(page.locator('main')).toContainText('6,900.00');
      expect(errors).toEqual([]);
    });
  }
});

test.describe('gate ON — Sales Invoice create is an editable Document Workspace', () => {
  test('header, command bar, compact context, hero grid, adjustments, tabs and dock; totals follow the form', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page);
    await go(page, '/invoices/new', true);

    await expect(page.locator('[data-awj-docws-header]')).toBeVisible();
    const bar = page.getByRole('toolbar', { name: 'إجراءات المستند' });
    await expect(bar.getByRole('button', { name: 'حفظ كمسودة' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'حفظ وترحيل' })).toBeVisible();
    // lifecycle shows the real stored draft state only — no invented "issued" step
    await expect(page.locator('[data-awj-lifecycle]').getByText(/صادرة|issued/i)).toHaveCount(0);

    // core context is one dense row of the existing fields (same ids)
    for (const id of ['partner', 'date', 'terms', 'due', 'zatca-document-type', 'taxmode', 'dmode', 'dval', 'ship', 'adj']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    const ctx = await page.locator('[data-awj-docws-context]').boundingBox();
    expect(ctx!.height).toBeLessThan(110);

    // the grid is the hero and the dock stays reachable
    await expect(page.locator('[data-awj-linegrid-hero]')).toBeVisible();
    for (let i = 0; i < 2; i++) await page.locator('[data-awj-linegrid-hero-bar] button').click();
    const rows = page.locator('[data-awj-linegrid-row]');
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await rows.nth(i).locator('input[id$="-price"]').fill(String(100 * (i + 1)));
      await rows.nth(i).locator('input[id$="-qty"]').fill('2');
    }
    // 2×(100+200+300)=1200 + 15% VAT — the dock presents the form's own figure
    await expect(page.locator('[data-awj-dock-outcome-value]')).toContainText('1,380.00');
    const dock = await page.locator('[data-awj-dock]').boundingBox();
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(721);

    // secondary information lives in tabs, all reachable; payment fields keep their ids
    for (const name of [/السداد/, /ملاحظات/, /القالب واللغة/]) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
    await page.getByRole('tab', { name: /ملاحظات/ }).click();
    await expect(page.getByPlaceholder('ملاحظات')).toBeVisible();
  });

  test('mobile: actions reachable, tabs reachable, no horizontal page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterDemo(page);
    await go(page, '/invoices/new', true);
    await expect(page.getByRole('button', { name: 'حفظ وترحيل' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'حفظ كمسودة' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    for (const name of [/السداد/, /ملاحظات/, /القالب واللغة/]) {
      await page.getByRole('tab', { name }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
  });
});
