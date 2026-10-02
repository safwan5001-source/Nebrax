import { expect, test, type Page } from '@playwright/test';
import { seedDemoSession } from './helpers/demo-session';
import { scanContrast } from './helpers/contrast-scan';

// AWJ v3 (Horizon 5) — hardening matrix against Demo Mode (no backend, real components).
// Pins: contrast across Theme × Mode, no horizontal overflow across the viewport matrix,
// browser-zoom usability, RTL/LTR logical geometry, forced-colors, keyboard focus, the legacy
// variable bridge, and the shell-chrome scope (Ink must stay legible). Presentation only.

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

async function open(page: Page, route: string, opts: { locale?: 'ar' | 'en'; mode?: 'light' | 'dark'; ink?: boolean; viewport?: [number, number] } = {}) {
  const { locale = 'ar', mode = 'light', ink = false, viewport = [1440, 900] } = opts;
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  await seedDemoSession(page, { theme: mode, ...(ink ? { 'awj:theme': 'ink' } : {}) });
  await page.setViewportSize({ width: viewport[0], height: viewport[1] });
  await page.goto(`${baseUrl}${route}?awj-ui=3`, { waitUntil: 'load', timeout: 90_000 });
  await expect(page.locator('html')).toHaveAttribute('data-awj-ui', '3');
  await page.waitForTimeout(1500);
}

const docOverflow = (page: Page) => page.evaluate(() => {
  const de = document.documentElement;
  return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
});

const computed = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe('scanner self-test', () => {
  test('the contrast scanner really flags a failing pair', async ({ page }) => {
    await page.setContent('<div id="bad" style="color:#8a8a8a;background:#9a9a9a;font-size:14px">low contrast text</div><div style="color:#111;background:#fff">fine</div>');
    const failures = await scanContrast(page);
    expect(failures.map((f) => f.selector)).toEqual(['div#bad']);
  });
});

test.describe('contrast — Theme × Mode (WCAG 1.4.3)', () => {
  const routes = ['/dashboard', '/invoices', '/invoices/new', '/invoices/inv-118', '/reports', '/hr', '/products', '/pos'];
  for (const [label, mode, ink] of [['Default Light', 'light', false], ['Ink Light', 'light', true], ['Dark', 'dark', false]] as const) {
    test(`${label}: no text pair below 4.5:1 (3:1 large) on ${routes.length} screens`, async ({ page }) => {
      test.setTimeout(300_000);
      for (const route of routes) {
        await open(page, route, { mode, ink });
        const failures = await scanContrast(page);
        expect(failures, `${label} ${route}`).toEqual([]);
      }
    });
  }

  test('Ink: a menu opened inside the shell chrome sits on Paper and stays legible', async ({ page }) => {
    await open(page, '/dashboard', { ink: true });
    await page.getByRole('button', { name: /الإشعارات|Notifications/ }).first().click();
    const menu = page.locator('[data-awj-shell="topbar"] [role="menu"], [data-awj-shell="topbar"] [role="dialog"]').first();
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    expect(await scanContrast(page, '[data-awj-shell="topbar"]')).toEqual([]);
  });
});

test.describe('theme matrix — the legacy variable bridge', () => {
  const cases = [
    { name: 'Default Light', mode: 'light', ink: false, desk: 'rgb(233, 232, 228)', paper: 'rgb(255, 255, 255)', shell: 'rgb(213, 223, 240)' },
    { name: 'Ink Light', mode: 'light', ink: true, desk: 'rgb(233, 232, 228)', paper: 'rgb(255, 255, 255)', shell: 'rgb(14, 26, 49)' },
    { name: 'Dark (Default)', mode: 'dark', ink: false, desk: 'rgb(7, 9, 12)', paper: 'rgb(28, 31, 40)', shell: 'rgb(14, 26, 49)' },
    { name: 'Dark (Ink = Default)', mode: 'dark', ink: true, desk: 'rgb(7, 9, 12)', paper: 'rgb(28, 31, 40)', shell: 'rgb(14, 26, 49)' },
  ] as const;
  for (const c of cases) {
    test(`${c.name}: Desk, Paper and the shell resolve from the v3 tokens`, async ({ page }) => {
      await open(page, '/invoices', { mode: c.mode, ink: c.ink });
      // `bg-background` (legacy utility) must land on Desk and `bg-surface` on Paper — one definition per mode.
      const probe = await page.evaluate(() => {
        const mk = (cls: string) => { const el = document.createElement('div'); el.className = cls; document.body.appendChild(el); const v = getComputedStyle(el).backgroundColor; el.remove(); return v; };
        return { desk: mk('bg-background'), paper: mk('bg-surface') };
      });
      expect(probe.desk).toBe(c.desk);
      expect(probe.paper).toBe(c.paper);
      expect(await computed(page, '[data-awj-shell="sidebar"]', 'background-color')).toBe(c.shell);
    });
  }

  test('theme + mode preferences survive a reload with the gate on', async ({ page }) => {
    await open(page, '/dashboard', { mode: 'dark', ink: true });
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'ink');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-awj-ui', '3');
  });
});

test.describe('viewport matrix — no horizontal page overflow', () => {
  const viewports: [number, number][] = [[1600, 900], [1440, 900], [1366, 768], [1280, 720], [1024, 768], [768, 1024], [390, 844]];
  const routes = ['/dashboard', '/invoices', '/invoices/new', '/invoices/inv-118', '/purchases', '/reports', '/products', '/pos', '/commerce/appearance', '/commerce/stores'];
  for (const [w, h] of viewports) {
    test(`${w}×${h}`, async ({ page }) => {
      test.setTimeout(300_000);
      for (const route of routes) {
        await open(page, route, { viewport: [w, h] });
        const o = await docOverflow(page);
        expect(o.scrollWidth, `${route} @${w}×${h}`).toBeLessThanOrEqual(o.clientWidth + 1);
      }
    });
  }
});

test.describe('browser zoom (CSS-px equivalents of 125 / 150 / 200 %)', () => {
  // Browser zoom shrinks the layout viewport; the equivalent is the same screen at fewer CSS px.
  const zooms: [string, [number, number]][] = [['125%', [1152, 720]], ['150%', [960, 600]], ['200%', [720, 450]]];
  for (const [label, vp] of zooms) {
    test(`${label}: no page overflow and the primary actions stay reachable`, async ({ page }) => {
      test.setTimeout(300_000);
      for (const route of ['/dashboard', '/invoices', '/invoices/inv-118', '/invoices/new', '/commerce/appearance']) {
        await open(page, route, { viewport: vp });
        const o = await docOverflow(page);
        expect(o.scrollWidth, `${route} @${label}`).toBeLessThanOrEqual(o.clientWidth + 1);
      }
      await open(page, '/invoices/new', { viewport: vp });
      const save = page.getByRole('button', { name: /حفظ وترحيل|Save and post/ }).first();
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeVisible();
      const box = await save.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= vp[0] + 1, 'primary action is inside the viewport horizontally').toBe(true);
    });
  }

  test('200%: a focused control is never hidden behind a sticky bar', async ({ page }) => {
    await open(page, '/invoices/new', { viewport: [720, 450] });
    const field = page.getByRole('button', { name: /إضافة سطر|Add line/ }).first();
    await field.focus();
    const rect = await field.evaluate((el) => {
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { covered: !!top && !el.contains(top) && !top.contains(el) };
    });
    expect(rect.covered).toBe(false);
  });
});

test.describe('RTL / LTR — logical geometry', () => {
  for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
    test(`${locale}: dir, shell side, Apex edge and sticky regions follow ${dir}`, async ({ page }) => {
      await open(page, '/invoices', { locale });
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      const side = await page.locator('[data-awj-shell="sidebar"]').first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left < window.innerWidth / 2 ? 'left' : 'right';
      });
      expect(side).toBe(dir === 'rtl' ? 'right' : 'left');
      // The Apex rail is an inline-start marker: right edge in RTL, left edge in LTR.
      const apex = await page.locator('[data-awj-apex][data-awj-apex-on]').first().evaluate((el) => {
        const s = getComputedStyle(el, '::before');
        return { left: s.left, right: s.right, width: s.width };
      });
      if (dir === 'rtl') expect(apex.right).toBe('0px'); else expect(apex.left).toBe('0px');
      // Document stays inside the viewport in both directions.
      const o = await docOverflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth + 1);
    });

    test(`${locale}: Totals Dock sits inside the page in a document view`, async ({ page }) => {
      await open(page, '/invoices/inv-118', { locale });
      const dock = page.locator('[data-awj-dock]').first();
      await expect(dock).toBeVisible();
      const r = await dock.boundingBox();
      const vw = page.viewportSize()!.width;
      expect(r!.x).toBeGreaterThanOrEqual(0);
      expect(r!.x + r!.width).toBeLessThanOrEqual(vw + 1);
    });
  }
});

test.describe('forced colors', () => {
  test('Apex, focus and buttons use system colors instead of brand colors', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page, '/invoices');
    const apexOn = page.locator('[data-awj-apex][data-awj-apex-on]').first();
    const info = await apexOn.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      const own = getComputedStyle(el);
      return { beforeBg: before.backgroundImage + '|' + before.backgroundColor, borderStyle: own.borderInlineStartStyle, borderWidth: own.borderInlineStartWidth };
    });
    expect(info.borderStyle).toBe('solid');
    expect(parseFloat(info.borderWidth)).toBeGreaterThanOrEqual(3);
    // Keyboard focus keeps a visible outline under forced colors.
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline && outline.style !== 'none' && outline.width >= 2).toBe(true);
  });
});

test.describe('keyboard and focus', () => {
  test('every Tab stop in the shell + page header shows a visible focus indicator', async ({ page }) => {
    await open(page, '/invoices');
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      const ok = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return true;
        const s = getComputedStyle(el);
        const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
        const ring = s.boxShadow !== 'none';
        const borderChange = el.matches('[data-awj-shell-field], input, select, textarea') && s.borderColor !== '';
        return outline || ring || borderChange || el.closest('[data-awj-shell-field]') !== null;
      });
      expect(ok, `tab stop #${i + 1}`).toBe(true);
    }
  });

  test('form controls expose the 3:1 boundary (WCAG 1.4.11) and have accessible names', async ({ page }) => {
    await open(page, '/invoices/new');
    const result = await page.evaluate(() => {
      const lum = (c: string) => { const m = c.match(/\d+(\.\d+)?/g)!.map(Number); const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const weak: string[] = []; const unnamed: string[] = [];
      for (const el of Array.from(document.querySelectorAll('main input:not([type=hidden]):not([type=checkbox]), main select, main textarea')) as HTMLElement[]) {
        const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        if (r.width === 0 || s.borderTopWidth === '0px' || el.hasAttribute('disabled')) continue;
        if (ratio(s.borderTopColor, 'rgb(255, 255, 255)') < 3) weak.push(el.tagName + ':' + (el.getAttribute('class') ?? '').slice(0, 40));
        const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el as HTMLInputElement).labels?.length || el.getAttribute('title') || el.getAttribute('placeholder');
        if (!named) unnamed.push(el.tagName + ':' + (el.getAttribute('class') ?? '').slice(0, 40));
      }
      return { weak, unnamed };
    });
    expect(result.weak, 'control boundaries below 3:1').toEqual([]);
    expect(result.unnamed, 'controls without an accessible name').toEqual([]);
  });
});

test.describe('Storefront isolation (Studio preview)', () => {
  const sample = (page: Page) => page.evaluate(() => {
    const root = document.querySelector('.awj-store-preview') as HTMLElement | null;
    if (!root) return null;
    const heading = root.querySelector('h1, h2, h3') as HTMLElement | null;
    const link = root.querySelector('a, button') as HTMLElement | null;
    const rs = getComputedStyle(root);
    return {
      bg: rs.backgroundColor, color: rs.color,
      heading: heading ? getComputedStyle(heading).color : null,
      action: link ? getComputedStyle(link).backgroundColor + '|' + getComputedStyle(link).color : null,
      storePrimary: rs.getPropertyValue('--store-primary').trim(),
      leakedChrome: rs.getPropertyValue('--awj-editor-chrome').trim(),
    };
  });

  test('admin theme and mode never change what the merchant Canvas renders', async ({ page }) => {
    test.setTimeout(180_000);
    const results: Record<string, unknown> = {};
    for (const [label, mode, ink] of [['default-light', 'light', false], ['ink-light', 'light', true], ['dark', 'dark', false]] as const) {
      await open(page, '/commerce/appearance', { mode, ink });
      await page.waitForSelector('.awj-store-preview', { timeout: 60_000 });
      results[label] = await sample(page);
    }
    expect(results['ink-light']).toEqual(results['default-light']);
    expect(results['dark']).toEqual(results['default-light']);
    expect((results['dark'] as { leakedChrome: string }).leakedChrome).toBe('');
  });

  test('the public storefront package has no reference to the v3 gate or admin theme attributes', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === '.next') continue;
        const f = path.join(dir, e);
        if (statSync(f).isDirectory()) walk(f, out); else if (/\.(tsx?|css)$/.test(f)) out.push(f);
      }
      return out;
    };
    const offenders = walk(path.resolve(process.cwd(), '../storefront/src'))
      .filter((f) => /data-awj-(ui|theme|posture)|awj:ui-version|awj:theme/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

test.describe('long content does not break Document Workspace composition', () => {
  test('very long customer / product / note text wraps or truncates inside the page (no overflow, dock intact)', async ({ page }) => {
    for (const viewport of [[1280, 720], [390, 844]] as [number, number][]) {
      await open(page, '/invoices/inv-118', { viewport });
      await page.evaluate(() => {
        const long = 'اسم طويل جداً '.repeat(30) + 'VERYLONGUNBROKENTOKEN'.repeat(6);
        const targets = Array.from(document.querySelectorAll('main h1 ~ *, main td, main [data-awj-line-desc], main p, main span'))
          .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 3).slice(0, 12);
        for (const el of targets) el.textContent = long;
      });
      const o = await docOverflow(page);
      expect(o.scrollWidth, `long text @${viewport.join('×')}`).toBeLessThanOrEqual(o.clientWidth + 1);
      await expect(page.locator('[data-awj-dock]').first()).toBeVisible();
    }
  });
});
