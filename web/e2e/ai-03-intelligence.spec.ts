import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import {
  agingResult, blockedStatus, incomeResult, makeStatus, messageResponse,
} from '../src/modules/intelligence/__tests__/fixtures';
import type { AssistantStatus } from '../src/modules/intelligence/contract';

/**
 * AI-03 — Visual QA + UX journeys. الخادم مُعترَض بالكامل (لا خلفية، لا مزوّد): الأرقام من fixtures ثابتة.
 * اللقطات تُكتب في docs/reports/ai-03-visual-qa/ باسم المشروع (desktop|mobile) واللغة والوضع.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shotDir = process.env.AI03_SHOT_DIR ?? '../docs/reports/ai-03-visual-qa/after';
mkdirSync(shotDir, { recursive: true });

type Locale = 'ar' | 'en';
type Mode = 'light' | 'dark';
type AppTheme = 'default' | 'ink' | 'core';

interface Scene {
  locale?: Locale;
  mode?: Mode;
  appTheme?: AppTheme;
  status?: AssistantStatus;
  permissions?: string[];
  route?: string;
  toolRun?: (body: { tool: string }) => { status: number; body: unknown };
  message?: () => { status: number; body: unknown };
}

const calls: { path: string; method: string }[] = [];

async function open(page: Page, scene: Scene = {}) {
  const locale = scene.locale ?? 'en';
  const permissions = scene.permissions ?? ['*'];
  const status = scene.status ?? makeStatus();
  calls.length = 0;

  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, code = 200) =>
    route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });

  const stored = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: permissions.includes('*') ? 'owner' : 'accountant', permissions };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api/, '');
    calls.push({ path, method: request.method() });
    if (path === '/me') return json(route, { user: stored, company: { name: 'Acme' } });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/ai-assistant/status') return json(route, { data: status });
    if (path === '/ai-assistant/tools/run') {
      const body = request.postDataJSON() as { tool: string };
      const custom = scene.toolRun?.(body);
      if (custom) return json(route, custom.body, custom.status);
      const result = body.tool === 'finance.income_statement' ? incomeResult() : agingResult(body.tool === 'finance.payables_aging' ? 'payables_aging' : 'receivables_aging');
      return json(route, { data: { request_id: 'req-run', status: 'ok', tool_calls: [{ tool: body.tool, result }] } });
    }
    if (path === '/ai-assistant/messages') {
      const custom = scene.message?.();
      if (custom) return json(route, custom.body, custom.status);
      return json(route, { data: messageResponse() });
    }
    if (path === '/ai-assistant/settings') return json(route, { data: makeStatus() });
    if (path === '/ai-assistant/audit-events') {
      return json(route, { data: [
        { id: 'e1', request_id: 'r1', actor_id: 'me', event: 'consent.updated', tool: null, outcome: 'allowed', reason: 'ok', occurred_at: '2026-10-16 09:12:00' },
        { id: 'e2', request_id: 'r2', actor_id: 'me', event: 'tool_run', tool: 'finance.income_statement', outcome: 'allowed', reason: 'ok', occurred_at: '2026-10-16 09:20:00' },
        { id: 'e3', request_id: 'r3', actor_id: 'me', event: 'tool_run', tool: 'finance.receivables_aging', outcome: 'denied', reason: 'consent_required', occurred_at: '2026-10-16 09:31:00' },
      ], meta: { current_page: 1, per_page: 10, total: 3, last_page: 1 } });
    }
    // التقرير الأصلي (للتنقّل ذهاباً وإياباً فقط) — شكل أدنى صالح كي لا تنهار الصفحة المستضيفة.
    if (path.startsWith('/reports/income-statement')) {
      return json(route, { revenues: [], expenses: [], total_revenue: '12345.00', total_expense: '4000.00', net_income: '8345.00' });
    }
    return json(route, { data: [] });
  });

  await page.addInitScript(({ user, mode, appTheme }) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', user);
    localStorage.setItem('theme', mode);
    localStorage.setItem('awj:theme', appTheme);
  }, { user: JSON.stringify(stored), mode: scene.mode ?? 'light', appTheme: scene.appTheme ?? 'default' });
  await page.goto(`${baseUrl}${scene.route ?? '/dashboard'}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const shot = async (page: Page, name: string, testInfo: { project: { name: string } }) => {
  await page.waitForTimeout(350); // بعد انتهاء حركة الظهور (160ms) كي لا تُلتقط الشاشة وهي شفافة جزئياً
  return page.screenshot({ path: `${shotDir}/${testInfo.project.name}-${name}.png`, fullPage: false });
};

async function openAssistant(page: Page, locale: Locale, mobile: boolean) {
  const label = locale === 'ar' ? 'مساعد أَوْج الذكي' : 'AWJ assistant';
  if (mobile) {
    await page.getByRole('button', { name: locale === 'ar' ? 'الحساب' : 'Account' }).click();
    await page.getByRole('menuitem', { name: label }).click();
  } else {
    await page.getByRole('button', { name: label }).click();
  }
  await expect(page.getByRole('dialog').first()).toBeVisible();
}

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

const LOCALES: Locale[] = ['ar', 'en'];
const MODES: Mode[] = ['light', 'dark'];

for (const locale of LOCALES) {
  for (const mode of MODES) {
    test.describe(`${locale} · ${mode}`, () => {
      test.setTimeout(120_000);
      const tag = `${locale}-${mode}`;

      test('panel: ready → suggestion → result summary (demo labelled) → canvas → original report → return', async ({ page }, testInfo) => {
        const mobile = testInfo.project.name === 'mobile';
        await open(page, { locale, mode, route: '/reports/general/income-statement' });
        await openAssistant(page, locale, mobile);
        const dialog = page.getByRole('dialog').first();
        await expect(dialog.getByText(locale === 'ar' ? 'اسأل عن أرقامك من تقاريرك' : 'Ask about your numbers, from your reports')).toBeVisible();
        expect(calls.some((c) => c.path === '/ai-assistant/tools/run' || c.path === '/ai-assistant/messages')).toBe(false); // nothing financial before a click
        await shot(page, `panel-empty-${tag}`, testInfo);

        await dialog.getByRole('button', { name: locale === 'ar' ? 'قائمة الدخل لهذا الشهر' : 'Income statement this month' }).click();
        await expect(dialog.getByText(locale === 'ar' ? 'تجريبي' : 'Demo').first()).toBeVisible();
        await expect(dialog.locator('[data-summary="income_statement"]')).toBeVisible();
        await noHorizontalOverflow(page);
        await shot(page, `panel-result-${tag}`, testInfo);

        // → Canvas
        await dialog.getByRole('button', { name: locale === 'ar' ? 'فتح في مساحة الذكاء المالي' : 'Open in Canvas' }).click();
        await expect(page).toHaveURL(/\/intelligence$/);
        await expect(page.locator('[data-result="income_statement"]')).toBeVisible();
        await noHorizontalOverflow(page);
        await shot(page, `canvas-income-${tag}`, testInfo);

        // → original report, then back to the canvas with the run still in memory
        await page.getByRole('link', { name: locale === 'ar' ? 'فتح التقرير الأصلي' : 'Open original report' }).first().click();
        await expect(page).toHaveURL(/\/reports\/general\/income-statement$/);
        await page.goBack();
        await expect(page).toHaveURL(/\/intelligence$/);
        await expect(page.locator('[data-result="income_statement"]')).toBeVisible();
      });

      test('canvas: empty, aging with warning, validation, budget refusal', async ({ page }, testInfo) => {
        await open(page, { locale, mode, route: '/intelligence' });
        await expect(page.getByText(locale === 'ar' ? 'اختر تقريراً وشغّله' : 'Pick a report and run it')).toBeVisible();
        expect(calls.some((c) => c.path === '/ai-assistant/tools/run')).toBe(false);
        await shot(page, `canvas-empty-${tag}`, testInfo);

        await page.locator('label', { hasText: locale === 'ar' ? 'أعمار الذمم المدينة' : 'Receivables aging' }).first().click();
        await page.getByRole('button', { name: locale === 'ar' ? 'تشغيل التقرير' : 'Run report' }).click();
        await expect(page.locator('[data-result="receivables_aging"]')).toBeVisible();
        await expect(page.getByRole('note')).toBeVisible();
        await noHorizontalOverflow(page);
        await shot(page, `canvas-aging-${tag}`, testInfo);
      });

      test('states: consent required / no permission / platform off / budget', async ({ page }, testInfo) => {
        await open(page, { locale, mode, route: '/intelligence', status: blockedStatus('consent_required') });
        await expect(page.locator('[data-notice="consent_required"]')).toBeVisible();
        await expect(page.getByRole('button', { name: locale === 'ar' ? 'تشغيل التقرير' : 'Run report' })).toHaveCount(0);
        await shot(page, `state-consent-admin-${tag}`, testInfo);

        await open(page, { locale, mode, route: '/intelligence', status: blockedStatus('consent_required', { abilities: { use: true, manage_consent: false, view_audit: false, partner_detail: false } }), permissions: ['ai.assistant.use', 'reports.view'] });
        await expect(page.locator('[data-notice="consent_required"]')).toBeVisible();
        await expect(page.getByRole('link', { name: locale === 'ar' ? 'فتح إعدادات المساعد' : 'Open assistant settings' })).toHaveCount(0);
        await shot(page, `state-consent-member-${tag}`, testInfo);

        await open(page, { locale, mode, route: '/intelligence', status: blockedStatus('platform_disabled') });
        await expect(page.locator('[data-notice="platform_disabled"]')).toBeVisible();
        await shot(page, `state-platform-off-${tag}`, testInfo);

        await open(page, {
          locale, mode, route: '/intelligence',
          toolRun: () => ({ status: 429, body: { error: { code: 'budget_exceeded', message: 'x' }, request_id: 'r' } }),
        });
        await page.getByRole('button', { name: locale === 'ar' ? 'تشغيل التقرير' : 'Run report' }).click();
        await expect(page.locator('[data-notice="budget_exceeded"]')).toBeVisible();
        await expect(page.locator('[data-result]')).toHaveCount(0);
        await shot(page, `state-budget-${tag}`, testInfo);
      });

      test('settings: consent controls, acknowledgement dialog, audit log', async ({ page }, testInfo) => {
        await open(page, { locale, mode, route: '/intelligence/settings', status: makeStatus({ abilities: { use: true, manage_consent: true, view_audit: true, partner_detail: true } }) });
        await expect(page.getByRole('switch').first()).toBeVisible();
        await expect(page.getByText('consent.updated')).toBeVisible();
        await noHorizontalOverflow(page);
        await shot(page, `settings-${tag}`, testInfo);

        await page.getByRole('switch', { name: locale === 'ar' ? /^الملخصات المالية/ : /^Financial summaries/ }).click(); // currently granted → revoke is immediate
        // grant flow on a fresh scene
        await open(page, { locale, mode, route: '/intelligence/settings', status: makeStatus({ tenant: { enabled: false, consented_categories: [] }, chat: 'tenant_disabled', financial: 'tenant_disabled', financial_tools: [], categories: [
          { key: 'assistant_messages', available: true, consented: false }, { key: 'financial_summary', available: true, consented: false }, { key: 'document_projected_text', available: false, consented: false }] }) });
        await page.getByRole('switch').first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await shot(page, `settings-dialog-${tag}`, testInfo);
      });
    });
  }
}

test.describe('themes (Ink / Core) with the v3 shell', () => {
  test.setTimeout(120_000);
  for (const appTheme of ['ink', 'core'] as AppTheme[]) {
    test(`canvas result under ${appTheme}`, async ({ page }, testInfo) => {
      await open(page, { locale: 'ar', mode: 'light', appTheme, route: '/intelligence?awj-ui=3' });
      await page.getByRole('button', { name: 'تشغيل التقرير' }).click();
      await expect(page.locator('[data-result="income_statement"]')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-awj-theme', appTheme);
      await shot(page, `canvas-${appTheme}-ar-light`, testInfo);
    });
  }
});

test.describe('journeys', () => {
  test.setTimeout(120_000);

  test('no permission: no trigger, direct URL shows a denial and sends no AI request', async ({ page }, testInfo) => {
    await open(page, { locale: 'en', permissions: ['invoices.view'], route: '/intelligence' });
    await expect(page.getByText('You do not have permission for this')).toBeVisible();
    await expect(page.getByRole('button', { name: 'AWJ assistant' })).toHaveCount(0);
    expect(calls.filter((c) => c.path.startsWith('/ai-assistant'))).toEqual([]);
    await shot(page, 'state-no-permission-en-light', testInfo);
  });

  test('panel and canvas share runs; tab key reaches composer; Escape closes and restores focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop keyboard journey');
    await open(page, { locale: 'en', route: '/dashboard' });
    const trigger = page.getByRole('button', { name: 'AWJ assistant' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByRole('textbox')).toBeFocused();
    await page.keyboard.type('income statement');
    await page.keyboard.press('Enter');
    await expect(dialog.locator('[data-summary="income_statement"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('theme toggle keeps the canvas result intact; language switch reloads cleanly', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'toggles live in the account menu on mobile');
    await open(page, { locale: 'en', mode: 'light', route: '/intelligence' });
    await page.getByRole('button', { name: 'Run report' }).click();
    await expect(page.locator('[data-result="income_statement"]')).toBeVisible();
    await page.getByRole('button', { name: 'Toggle color mode' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('[data-result="income_statement"]')).toBeVisible();
    await shot(page, 'canvas-theme-toggled-en', testInfo);
  });

  test('mobile: composer, back control and touch targets', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only');
    await open(page, { locale: 'ar', route: '/dashboard' });
    await openAssistant(page, 'ar', true);
    const dialog = page.getByRole('dialog').first();
    const box = await dialog.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(388); // full width, no side peek
    for (const name of ['رجوع إلى الصفحة', 'إرسال']) {
      const b = await dialog.getByRole('button', { name }).boundingBox();
      expect(b!.width, name).toBeGreaterThanOrEqual(43);
      expect(b!.height, name).toBeGreaterThanOrEqual(43);
    }
    await dialog.getByRole('button', { name: 'رجوع إلى الصفحة' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
