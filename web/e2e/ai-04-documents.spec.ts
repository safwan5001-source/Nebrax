import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { DOC_ID, docReadyStatus, documentProjection, makeStatus } from '../src/modules/intelligence/__tests__/fixtures';
import type { AssistantStatus } from '../src/modules/intelligence/contract';

/**
 * AI-04 — Visual QA + journeys للقراءة الآمنة لمستند مركز المستندات. الخادم مُعترَض بالكامل (لا خلفية ولا مزوّد):
 * القيم من fixtures ثابتة وليست بيانات مستأجر حقيقي. اللقطات في docs/reports/ai-04-visual-qa/.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shotDir = process.env.AI04_SHOT_DIR ?? '../docs/reports/ai-04-visual-qa';
mkdirSync(shotDir, { recursive: true });

type Locale = 'ar' | 'en';
type Mode = 'light' | 'dark';

interface Scene {
  locale?: Locale;
  mode?: Mode;
  status?: AssistantStatus;
  route?: string;
  permissions?: string[];
  read?: { status: number; body: unknown };
  appTheme?: 'default' | 'ink' | 'core';
}

const calls: { path: string; method: string; body?: unknown }[] = [];
const hosts = new Set<string>();

async function open(page: Page, scene: Scene = {}) {
  const locale = scene.locale ?? 'en';
  const permissions = scene.permissions ?? ['*'];
  const status = scene.status ?? docReadyStatus();
  calls.length = 0;
  hosts.clear();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));

  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, code = 200) =>
    route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  const stored = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: permissions.includes('*') ? 'owner' : 'accountant', permissions };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api/, '');
    calls.push({ path, method: request.method(), body: request.method() === 'POST' ? request.postDataJSON() : undefined });
    if (path === '/me') return json(route, { user: stored, company: { name: 'Acme' } });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/ai-assistant/status') return json(route, { data: status });
    if (path === '/ai-assistant/settings') return json(route, { data: docReadyStatus() });
    if (path === '/ai-assistant/tools/run') {
      if (scene.read) return json(route, scene.read.body, scene.read.status);
      return json(route, { data: { request_id: 'req-doc', status: 'ok', tool_calls: [{ tool: 'documents.projected_read', result: documentProjection() }] } });
    }
    if (path === `/document-batches/${DOC_ID}/review`) {
      return json(route, { data: {
        batch: { id: DOC_ID, status: 'ready_for_draft', version: 3, reviewer: null, document_type: 'purchase_invoice' },
        fields: [{ key: 'document_number', original: 'PI-2026-0042', current: 'PI-2026-0042' }], lines: [], warnings: [], files: [], matches: [], issues: [], history: [],
        processing_summary: null, linked_transaction: null, linked_purchase: null,
        capabilities: { view: true, review: true, manage: true, build_draft: true }, review_mode: 'full', readiness_gaps: [],
      } });
    }
    return json(route, { data: [] });
  });

  await page.addInitScript(({ user, mode, appTheme }) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', user);
    localStorage.setItem('theme', mode);
    localStorage.setItem('awj:theme', appTheme);
  }, { user: JSON.stringify(stored), mode: scene.mode ?? 'light', appTheme: scene.appTheme ?? 'default' });
  await page.goto(`${baseUrl}${scene.route ?? `/documents/${DOC_ID}`}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const shot = async (page: Page, name: string, testInfo: { project: { name: string } }) => {
  await page.waitForTimeout(350);
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
};

const readLabel = (locale: Locale) => (locale === 'ar' ? 'قراءة القيم المراجَعة' : 'Read reviewed values');

for (const locale of ['ar', 'en'] as Locale[]) {
  for (const mode of ['light', 'dark'] as Mode[]) {
    test.describe(`${locale} · ${mode}`, () => {
      test.setTimeout(120_000);
      const tag = `${locale}-${mode}`;

      test('ready → explicit read → reviewed projection with redaction, basis and source', async ({ page }, testInfo) => {
        const mobile = testInfo.project.name === 'mobile';
        await open(page, { locale, mode });
        await openAssistant(page, locale, mobile);
        const dialog = page.getByRole('dialog').first();
        await expect(dialog.getByRole('button', { name: readLabel(locale) })).toBeVisible();
        expect(calls.some((c) => c.path === '/ai-assistant/tools/run')).toBe(false); // لا قراءة قبل النقر
        await shot(page, `document-ready-${tag}`, testInfo);

        await dialog.getByRole('button', { name: readLabel(locale) }).click();
        await expect(dialog.locator('[data-result="document_projection"]')).toBeVisible();
        await expect(dialog.getByText('PI-2026-0042')).toBeVisible();
        await expect(dialog.locator('[data-redacted]')).toHaveCount(1);
        await noHorizontalOverflow(page);
        await shot(page, `document-result-${tag}`, testInfo);

        // مكالمة واحدة بالمعرّف من المسار فقط، ولا خروج خارج المضيف المحلي، ولا تخزين لمحتوى المستند.
        const reads = calls.filter((c) => c.path === '/ai-assistant/tools/run');
        expect(reads).toHaveLength(1);
        expect(reads[0].body).toEqual({ tool: 'documents.projected_read', arguments: { document_id: DOC_ID } });
        // المضيفان الوحيدان: التطبيق نفسه وأصل الـAPI المحلي (مُعترَض بالكامل أعلاه) — لا مضيف خارجي إطلاقاً.
        expect([...hosts].filter((host) => ![new URL(baseUrl).host, 'localhost:8000'].includes(host))).toEqual([]);
        const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
        expect(stored).not.toContain('PI-2026-0042');
        expect(stored).not.toContain('شركة المنارة');
      });

      test('states: consent missing, platform category off, hold, not reviewed', async ({ page }, testInfo) => {
        const mobile = testInfo.project.name === 'mobile';
        await open(page, { locale, mode, status: makeStatus({ document: 'consent_required' }) });
        await openAssistant(page, locale, mobile);
        const dialog = page.getByRole('dialog').first();
        await expect(dialog.locator('[data-document-section] [data-notice="consent_required"]')).toBeVisible();
        await expect(dialog.getByRole('button', { name: readLabel(locale) })).toHaveCount(0);
        await shot(page, `document-state-consent-${tag}`, testInfo);

        await open(page, { locale, mode, status: makeStatus({ document: 'category_unavailable' }) });
        await openAssistant(page, locale, mobile);
        await expect(page.getByRole('dialog').first().locator('[data-notice="category_unavailable"]')).toBeVisible();
        await shot(page, `document-state-platform-off-${tag}`, testInfo);

        await open(page, { locale, mode, read: { status: 409, body: { error: { code: 'document_on_hold', message: 'x' }, request_id: 'r' } } });
        await openAssistant(page, locale, mobile);
        await page.getByRole('dialog').first().getByRole('button', { name: readLabel(locale) }).click();
        await expect(page.getByRole('dialog').first().locator('[data-notice="document_on_hold"]')).toBeVisible();
        await expect(page.locator('[data-result="document_projection"]')).toHaveCount(0);
        await shot(page, `document-state-hold-${tag}`, testInfo);

        await open(page, { locale, mode, read: { status: 404, body: { error: { code: 'document_unavailable', message: 'x' }, request_id: 'r' } } });
        await openAssistant(page, locale, mobile);
        await page.getByRole('dialog').first().getByRole('button', { name: readLabel(locale) }).click();
        await expect(page.getByRole('dialog').first().locator('[data-notice="document_unavailable"]')).toBeVisible();
        await shot(page, `document-state-unavailable-${tag}`, testInfo);
      });

      test('settings: document category opt-in with its own privacy copy; locked while the platform is off', async ({ page }, testInfo) => {
        const status = docReadyStatus({
          tenant: { enabled: true, consented_categories: ['assistant_messages'] },
          categories: [
            { key: 'assistant_messages', available: true, consented: true },
            { key: 'financial_summary', available: true, consented: false },
            { key: 'document_projected_text', available: true, consented: false },
          ],
          document: 'consent_required',
        });
        await open(page, { locale, mode, route: '/intelligence/settings', status });
        const docSwitch = page.getByRole('switch', { name: locale === 'ar' ? /^نص المستندات المستخرج/ : /^Extracted document text/ });
        await expect(docSwitch).toBeEnabled();
        await noHorizontalOverflow(page);
        await shot(page, `settings-document-${tag}`, testInfo);
        await docSwitch.click();
        await expect(page.getByRole('dialog').locator('[data-privacy="document"]')).toBeVisible();
        await shot(page, `settings-document-dialog-${tag}`, testInfo);

        await open(page, { locale, mode, route: '/intelligence/settings', status: makeStatus() });
        await expect(page.getByRole('switch', { name: locale === 'ar' ? /^نص المستندات المستخرج/ : /^Extracted document text/ })).toBeDisabled();
        await shot(page, `settings-document-locked-${tag}`, testInfo);
      });
    });
  }
}

test.describe('themes and journeys', () => {
  test.setTimeout(120_000);

  for (const appTheme of ['ink', 'core'] as const) {
    test(`document result under ${appTheme}`, async ({ page }, testInfo) => {
      await open(page, { locale: 'ar', mode: 'light', appTheme, route: `/documents/${DOC_ID}?awj-ui=3` });
      await openAssistant(page, 'ar', testInfo.project.name === 'mobile');
      await page.getByRole('dialog').first().getByRole('button', { name: readLabel('ar') }).click();
      await expect(page.locator('[data-result="document_projection"]')).toBeVisible();
      await shot(page, `document-result-${appTheme}-ar-light`, testInfo);
    });
  }

  test('keyboard: open, read with Enter, close with Escape and return focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop keyboard journey');
    await open(page, { locale: 'en' });
    const trigger = page.getByRole('button', { name: 'AWJ assistant' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog').first();
    const read = dialog.getByRole('button', { name: readLabel('en') });
    await read.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.locator('[data-result="document_projection"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('a user without document view sees the real state and no read control', async ({ page }, testInfo) => {
    await open(page, { locale: 'en', permissions: ['ai.assistant.use'], status: makeStatus({ document: 'permission_denied' }) });
    await openAssistant(page, 'en', testInfo.project.name === 'mobile');
    await expect(page.getByRole('dialog').first().locator('[data-notice="permission_denied"]')).toBeVisible();
    await expect(page.getByRole('button', { name: readLabel('en') })).toHaveCount(0);
    expect(calls.some((c) => c.path === '/ai-assistant/tools/run')).toBe(false);
    await shot(page, 'document-state-no-permission-en-light', testInfo);
  });
});
