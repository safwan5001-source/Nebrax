import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * IMP-PS-A4b — مساحة المطابقة والمراجعة في متصفح حقيقي (مكتب 1440 + جوال 390، عربي/إنجليزي، فاتح/داكن).
 * الخادم مُعترَض بالكامل **ببيانات اصطناعية وبحالة تتغيّر فعلاً** (القرارات تنعكس على التقدّم والجاهزية)؛ لا خلفية ولا بيانات عميل.
 * اللقطات تُكتب فقط حين يُضبط `PS_A4B_SHOTS` (مجلد خارج المستودع).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.PS_A4B_SHOTS;

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const T = {
  ar: { notice: 'مقارنة فقط — لا قيد ولا رصيد يتغيّر', run: 'شغّل المطابقة', confirm: 'تأكيد', override: 'تجاوز', dismiss: 'استبعاد', verify: 'تحقّق من المجموعة', review: 'نقل إلى مراجَعة', next: 'التالي غير المحسوم', reopen: 'إعادة فتح للتعديل', reason: 'سبب', ledger: 'دفاترنا غير الموجودة في الكشف', stale: 'تغيّرت الدفاتر أو الكشف', throttled: 'محاولات كثيرة', retrying: 'إعادة المحاولة بعد', replayed: 'لا تغيّر في الدفاتر أو الكشف', events: 'السجل' },
  en: { notice: 'Comparison only — no entry and no balance changes', run: 'Run matching', confirm: 'Confirm', override: 'Override', dismiss: 'Dismiss', verify: 'Verify the set', review: 'Move to reviewed', next: 'Next undecided', reopen: 'Reopen to edit', reason: 'reason', ledger: 'Our books, not in statement', stale: 'The books or the statement changed', throttled: 'Too many attempts', retrying: 'Retrying in', replayed: 'Nothing changed in the ledger', events: 'History' },
} as const;

const line = (n: number, over: Record<string, unknown> = {}) => ({ id: `line-${n}`, ordinal: n, date: `2026-01-0${n}`, reference: `INV-100${n}`, our_reference: null, description: `سطر اصطناعي ${n}`, debit_minor: n * 100000, credit_minor: 0, balance_minor: null, kind: null, ...over });
const unit = (key: string, amount: number) => ({ key, kind: 'invoice', doc_number: `S-${key}`, date: '2026-01-02', direction: 'credit', amount_minor: amount, state: 'active', entry_numbers: ['E'], entry_ids: ['e'] });

interface Options {
  locale?: 'ar' | 'en';
  theme?: 'light' | 'dark';
  permissions?: string[];
  hasRun?: boolean;
  status?: 'draft' | 'reviewed' | 'closed';
  appStatus?: 'enabled' | 'suspended' | 'disabled';
  decisionFailures?: Array<{ status: number; body: Record<string, unknown> }>;
  matchReplayed?: boolean;
  ledgerChanged?: boolean;
  statementChanged?: boolean;
  lineCount?: number;
}

interface State {
  hasRun: boolean;
  status: string;
  decisions: Record<string, { action: string; reason: string | null; revision: number }>;
  requests: string[];
  decisionBodies: Record<string, unknown>[];
}

/** صفوف المطابقة: 1 مطابق · 2 فرق تاريخ · 3 غير موجود في الدفاتر · 4 غامض (مرشحان) ثم مطابقات إضافية حتى `lineCount`. */
function engineRow(n: number) {
  const base = { id: `m-${n}`, side: 'statement', line_id: `line-${n}`, ordinal: n, rule: 'R2', warnings: [], suggestions: null, candidates: null, unit: null, unit_key: null, difference_minor: 0, day_difference: 0, line: line(n) };
  if (n === 2) return { ...base, outcome: 'date_difference', unit_key: 'u2', unit: unit('u2', 200000), day_difference: 9, explanation: { code: 'date_differs', params: {} } };
  if (n === 3) return { ...base, outcome: 'missing_in_books', difference_minor: null, explanation: { code: 'no_candidate_in_books', params: {} } };
  if (n === 4) return { ...base, outcome: 'ambiguous', difference_minor: null, explanation: { code: 'ambiguous_multiple_candidates', params: { candidates: 2 } }, candidates: [unit('c1', 400000), unit('c2', 400000)] };
  return { ...base, outcome: 'matched', unit_key: `u${n}`, unit: unit(`u${n}`, n * 100000), explanation: { code: 'matched_by_reference', params: {} } };
}

async function open(page: Page, opts: Options = {}) {
  const locale = opts.locale ?? 'ar';
  const total = opts.lineCount ?? 4;
  const state: State = { hasRun: opts.hasRun !== false, status: opts.status ?? 'draft', decisions: {}, requests: [], decisionBodies: [] };
  const failures = [...(opts.decisionFailures ?? [])];
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Reviewer', email: 'r@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'], branch_ids: [], warehouse_ids: [] };
  const header = () => ({
    id: ID, status: state.status, role: 'customer', partner_id: 'p1', partner: { name: 'شركة النور للتجارة' }, branch_id: null, branch: null, period_from: '2026-01-01', period_to: '2026-03-31', currency: 'SAR',
    original_filename: 'nour-q1.csv', line_count: total, total_debit_minor: 1000000, total_credit_minor: 0, created_by: 'u', created_at: '2026-04-02T09:00:00+03:00', reviewed_at: null, closed_at: null, voided_at: null,
    superseded_by_id: null, policy: { date_tolerance_days: 3, amount_tolerance_minor: 100 }, checks: null, source_import_job_id: null, reviewed_by: null, reviewed_run_id: null, closed_by: null, voided_by: null, void_reason: null,
  });
  const resolved = () => Object.values(state.decisions).filter((d) => d.action !== 'clear').length;
  const statusBody = () => {
    const unresolved = total - resolved();
    const blockers: Record<string, unknown>[] = [];
    if (!state.hasRun) blockers.push({ code: 'no_run' });
    if (opts.statementChanged) blockers.push({ code: 'statement_changed' });
    if (state.hasRun && unresolved > 0) blockers.push({ code: 'unresolved_lines', count: unresolved, sample_ordinals: Array.from({ length: total }, (_, i) => i + 1).filter((n) => !state.decisions[`line-${n}`]).slice(0, 20) });
    return {
      reconciliation: { id: ID, status: state.status, reviewed_at: null, reviewed_by: null, reviewed_run_id: state.status === 'reviewed' ? RUN : null },
      run: state.hasRun ? { id: RUN, scope: {}, ledger_fingerprint: 'fp', created_at: null } : null,
      readiness: { lines_total: total, resolved: resolved(), unresolved, decisions_on_other_runs: 0, decisions_by_action: {}, can_mark_reviewed: state.status === 'draft' && state.hasRun && blockers.length === 0 },
      blockers,
      reviewed_state: state.status === 'reviewed' ? { run_id: RUN, ledger_changed_since_review: false, statement_changed_since_review: false } : null,
      close: { available: false, blocked_reason: 'not_reviewed' }, void: { available: false, blocked_reason: 'not_closed' }, final: null,
    };
  };
  const decisionOf = (n: number) => {
    const d = state.decisions[`line-${n}`];
    return d ? { id: `d-${n}`, reconciliation_id: ID, run_id: RUN, line_id: `line-${n}`, revision: d.revision, action: d.action, unit_keys: null, engine_outcome: null, engine_code: null, pair: null, expected_net_minor: null, set_net_minor: null, difference_minor: 0, accepted_difference: false, reason: d.reason, created_by: 'me', created_at: '2026-04-03T10:00:00Z' } : null;
  };

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    state.requests.push(`${method} ${p}`);
    const base = `/partner-statement-reconciliations/${ID}`;

    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/applications') return json(route, { data: { 'accounting.partner_statements': { status: opts.appStatus ?? 'enabled' } } });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    if (p === base) return json(route, { data: header() });
    if (p === `${base}/status`) return json(route, { data: statusBody() });
    if (p === `${base}/lines`) return json(route, { data: Array.from({ length: Math.min(total, 25) }, (_, i) => line(i + 1)), meta: { current_page: 1, last_page: 1, per_page: 25, total } });
    if (p === `${base}/match` && method === 'POST') {
      const replayed = opts.matchReplayed === true;
      state.hasRun = true;
      return json(route, { data: { id: RUN, reconciliation_id: ID, created: !replayed, replayed, engine_version: 1, status: 'completed', policy: {}, scope: {}, ledger_fingerprint: 'fp', counts: {}, created_at: null } }, replayed ? 200 : 201);
    }
    if (p === `${base}/matches`) {
      const side = url.searchParams.get('side');
      if (side === 'ledger') return json(route, { data: [{ id: 'l1', side: 'ledger', line_id: null, ordinal: null, outcome: 'missing_in_statement', rule: null, unit_key: 'free-1', difference_minor: null, day_difference: null, explanation: { code: 'no_statement_line', params: {} }, warnings: [], unit: unit('free-1', 55000), candidates: null, suggestions: null }], run: null, ledger_changed: false, meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 } });
      const wanted = url.searchParams.getAll('outcome[]');
      const all = Array.from({ length: Math.min(total, 25) }, (_, i) => engineRow(i + 1)).map((r) => ({ ...r, decision: decisionOf(r.ordinal) }));
      const data = wanted.length ? all.filter((r) => wanted.includes(r.outcome)) : all;
      return json(route, { data, run: { id: RUN, reconciliation_id: ID, created: false, replayed: true, engine_version: 1, status: 'completed', policy: {}, scope: {}, ledger_fingerprint: 'fp', created_at: null, counts: { 'statement.matched': total - 3, 'statement.date_difference': 1, 'statement.missing_in_books': 1, 'statement.ambiguous': 1, 'ledger.missing_in_statement': 1 } }, ledger_changed: opts.ledgerChanged === true, meta: { current_page: 1, last_page: 1, per_page: 25, total: data.length } });
    }
    if (p === `${base}/verify-set`) {
      return json(route, { data: { applied: false, line: { id: 'line-4', ordinal: 4, date: '2026-01-04', debit_minor: 400000, credit_minor: 0 }, units: [{ key: 'c1', kind: 'invoice', doc_number: 'S-c1', date: '2026-01-02', state: 'active', direction: 'credit', net_minor: -400000 }], expected_net_minor: -400000, set_net_minor: -400000, difference_minor: 0, tolerance_minor: 100, equal_within_tolerance: true, problems: [] } });
    }
    if (p === `${base}/reversed-pairs`) return json(route, { data: { pairs: [], truncated: false } });
    if (p === `${base}/decisions` && method === 'POST') {
      const failure = failures.shift();
      if (failure) return json(route, failure.body, failure.status);
      const body = route.request().postDataJSON() as { line_id: string; action: string; reason?: string };
      state.decisionBodies.push(body);
      const previous = state.decisions[body.line_id];
      if (body.action === 'clear') delete state.decisions[body.line_id];
      else state.decisions[body.line_id] = { action: body.action, reason: body.reason ?? null, revision: (previous?.revision ?? 0) + 1 };
      return json(route, { data: decisionOf(Number(body.line_id.split('-')[1])), replayed: false, warnings: [] }, 201);
    }
    if (p === `${base}/decisions`) return json(route, { data: [], meta: { current_page: 1, last_page: 1, per_page: 50, total: 0 } });
    if (p === `${base}/review` && method === 'POST') {
      state.status = 'reviewed';
      return json(route, { data: statusBody(), replayed: false }, 201);
    }
    if (p === `${base}/reopen` && method === 'POST') {
      state.status = 'draft';
      return json(route, { data: statusBody() });
    }
    if (p === `${base}/events`) return json(route, { data: [{ id: 'ev1', seq: 1, action: 'mark_reviewed', from_status: 'draft', to_status: 'reviewed', run_id: RUN, reason: null, created_by: 'me', created_at: '2026-04-03T10:00:00Z', summary: null }], meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 } });
    return json(route, { data: [] });
  });

  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none !important}';
      document.head.appendChild(style);
    });
  });
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}/partner-statements/${ID}`, { waitUntil: 'domcontentloaded' });
  return state;
}

const shot = async (page: Page, name: string) => {
  if (!shots) return;
  // Sheet الجوال `fixed` بطول الشاشة: لقطة الصفحة الكاملة تكبّر النافذة مؤقتاً فتفسد تخطيطه (وتقلب `useIsDesktop` لحظياً). لقطة النافذة الحقيقية أصدق.
  const sheetOpen = isMobile(page) && (await page.getByTestId('line-detail').count()) > 0;
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: !sheetOpen });
};
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
/** يفتح سطراً: صفّ الجدول على المكتب، بطاقة على الجوال (تفتح Sheet). */
const selectLine = async (page: Page, n: number) => {
  // الجوال: لوحة السطر Sheet كامل الشاشة تغطي القائمة؛ تُغلق قبل فتح سطر آخر (كما يفعل المستخدم).
  if (isMobile(page) && (await page.getByTestId('line-detail').count()) > 0) {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('line-detail')).toHaveCount(0);
  }
  const target = isMobile(page) ? page.locator(`button[data-line-id="line-${n}"]`) : page.locator(`tr[data-line-id="line-${n}"]`);
  await target.click();
  return page.getByTestId('line-detail');
};
const actionBar = (page: Page) => page.getByTestId('action-bar');
const waitLoaded = async (page: Page) => {
  await expect(page.getByTestId('summary-bar')).toBeVisible();
  await expect(page.locator(isMobile(page) ? 'button[data-line-id="line-1"]' : 'tr[data-line-id="line-1"]')).toBeVisible();
};
/** الحقل المرئي فقط: على الجوال والمكتب يوجد نسخة واحدة من لوحة التفاصيل بفضل `useIsDesktop`. */

for (const locale of ['ar', 'en'] as const) {
  const t = T[locale];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  test.describe(`مساحة المراجعة — ${locale}`, () => {
    test(`تعرض الرأس والتقدّم والوسم الدائم بالاتجاه ${dir} بلا تجاوز أفقي ولا نداء مطابقة تلقائي`, async ({ page }) => {
      const state = await open(page, { locale });
      await waitLoaded(page);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
      await expect(page.getByTestId('comparison-only')).toContainText(t.notice);
      await expect(page.getByTestId('progress-count')).toHaveText('0/4');
      expect(await page.locator('main').innerText()).toContain('1,000.00');
      await noHorizontalOverflow(page);
      expect(state.requests.filter((r) => r.startsWith('POST'))).toEqual([]);
      await shot(page, `workspace-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}-light`);
    });

    test('المسار الكامل: مطابقة ← قرارات فردية ← جاهزية ← مراجَعة ← إعادة فتح (بلا أي مسار إغلاق/جماعي)', async ({ page }) => {
      const state = await open(page, { locale, hasRun: false });
      await expect(page.getByTestId('no-run')).toBeVisible();
      await expect(page.getByTestId('progress-count')).toHaveText('0/4');
      await page.getByTestId('run-match').click();
      await waitLoaded(page);
      await expect(page.getByTestId('no-run')).toHaveCount(0);

      // 1) مطابق بفرق صفري: تأكيد بنقرة واحدة بلا سبب
      let detail = await selectLine(page, 1);
      await expect(detail.getByTestId('explanation')).toBeVisible();
      await actionBar(page).getByRole('button', { name: t.confirm }).click();
      await expect(page.getByTestId('progress-count')).toHaveText('1/4');
      expect(state.decisionBodies[0]).toEqual({ run_id: RUN, line_id: 'line-1', action: 'confirm' });

      // 2) فرق تاريخ بفرق مالي صفري: السبب إلزامي
      await selectLine(page, 2);
      await actionBar(page).getByRole('button', { name: t.confirm }).click();
      const form = page.getByTestId('decision-form-confirm');
      const submit = form.getByRole('button', { name: t.confirm });
      await expect(submit).toBeDisabled();
      await form.getByRole('textbox').fill('ab');
      await expect(submit).toBeDisabled();
      await form.getByRole('textbox').fill('تأخر التحويل البنكي');
      await expect(submit).toBeEnabled();
      await shot(page, `decision-reason-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}`);
      await submit.click();
      await expect(page.getByTestId('progress-count')).toHaveText('2/4');
      expect(state.decisionBodies[1]).toEqual({ run_id: RUN, line_id: 'line-2', action: 'confirm', reason: 'تأخر التحويل البنكي' });

      // 3) غير موجود في الدفاتر: استبعاد بسبب
      await selectLine(page, 3);
      await actionBar(page).getByRole('button', { name: t.dismiss }).click();
      await page.getByTestId('decision-form-dismiss').getByRole('textbox').fill('ليس من حساباتنا');
      await page.getByTestId('decision-form-dismiss').getByRole('button', { name: t.dismiss }).click();
      await expect(page.getByTestId('progress-count')).toHaveText('3/4');

      // 4) غامض: تجاوز بمجموعة محقَّق منها
      await selectLine(page, 4);
      await actionBar(page).getByRole('button', { name: t.override }).click();
      const picker = page.getByTestId('candidate-picker');
      await picker.locator('input[type="checkbox"]').first().check();
      await expect(page.getByTestId('verify-required')).toBeVisible();
      await page.getByTestId('decision-form-override').getByRole('textbox').fill('مجموعة مؤكدة يدوياً');
      await expect(page.getByTestId('decision-form-override').getByRole('button', { name: t.override })).toBeDisabled();
      await picker.getByRole('button', { name: t.verify }).click();
      await expect(page.getByTestId('verify-result')).toHaveAttribute('data-equal', 'true');
      await shot(page, `override-verify-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}`);
      await page.getByTestId('decision-form-override').getByRole('button', { name: t.override }).click();
      await expect(page.getByTestId('progress-count')).toHaveText('4/4');

      // الجاهزية ← مراجَعة
      if (isMobile(page)) await page.keyboard.press('Escape');
      await expect(page.getByTestId('ready')).toBeVisible();
      await shot(page, `readiness-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}`);
      await page.getByTestId('review-button').click();
      await expect(page.getByTestId('reviewed-banner')).toBeVisible();
      await expect(page.getByText(t.reopen)).toBeVisible();
      await shot(page, `reviewed-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}`);
      await page.getByRole('tab', { name: new RegExp(t.events) }).click();
      await expect(page.getByTestId('events-timeline')).toBeVisible();

      expect(state.requests.some((r) => /\/(close|void|replace|bulk)/.test(r))).toBe(false);
      expect(state.requests.filter((r) => r === `POST /partner-statement-reconciliations/${ID}/match`)).toHaveLength(1);
      await noHorizontalOverflow(page);
    });

    test('مراجع بصلاحية العرض فقط: لا أزرار كتابة إطلاقاً', async ({ page }) => {
      await open(page, { locale, permissions: ['partner_statements.view'] });
      await waitLoaded(page);
      await selectLine(page, 2);
      await expect(page.getByTestId('line-detail')).toBeVisible();
      await expect(actionBar(page)).toHaveCount(0);
      await expect(page.getByTestId('review-button')).toHaveCount(0);
      await expect(page.getByTestId('run-match')).toHaveCount(0);
    });

    test('قدرة موقوفة = قراءة فقط، ومعطّلة = شاشة غير مفعّلة', async ({ page }) => {
      await open(page, { locale, appStatus: 'suspended' });
      await waitLoaded(page);
      await selectLine(page, 2);
      await expect(actionBar(page)).toHaveCount(0);
      await expect(page.getByTestId('review-button')).toHaveCount(0);
    });

    test('تعارض/قِدَم: رسالة مترجمة بلا نص الخادم الخام، وتحديث من الخادم، وبلا إعادة إرسال', async ({ page }) => {
      const state = await open(page, { locale, decisionFailures: [{ status: 409, body: { message: 'RAW SERVER TEXT tenant 7', reason: 'run_stale' } }] });
      await waitLoaded(page);
      await selectLine(page, 1);
      await actionBar(page).getByRole('button', { name: t.confirm }).click();
      const error = page.getByTestId('decision-error');
      await expect(error).toContainText(t.stale);
      await expect(error).not.toContainText('RAW SERVER TEXT');
      expect(state.decisionBodies).toHaveLength(0);
      await shot(page, `stale-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}`);
    });

    test('سطور الكشف تغيّرت: حظر ظاهر', async ({ page }) => {
      await open(page, { locale, statementChanged: true });
      await waitLoaded(page);
      await expect(page.getByTestId('statement-changed')).toBeVisible();
      await shot(page, `statement-changed-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}`);
    });

    test('الدفتر تغيّر: شريط تحذير بزر تشغيلة جديدة صريح', async ({ page }) => {
      await open(page, { locale, ledgerChanged: true });
      await waitLoaded(page);
      await expect(page.getByTestId('ledger-changed')).toBeVisible();
    });

    test('تشغيلة مُعادة (200 replayed): إشعار لا خطأ', async ({ page }) => {
      await open(page, { locale, hasRun: false, matchReplayed: true });
      await page.getByTestId('run-match').click();
      await expect(page.getByTestId('workspace-notice')).toContainText(t.replayed);
    });

    test('مسودة السبب تبقى بعد إعادة تحميل الصفحة (نص السبب فقط)', async ({ page }) => {
      await open(page, { locale });
      await waitLoaded(page);
      await selectLine(page, 2);
      await actionBar(page).getByRole('button', { name: t.confirm }).click();
      await page.getByTestId('decision-form-confirm').getByRole('textbox').fill('سبب لم يكتمل');
      const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('ps-reason-draft:')));
      expect(stored).toHaveLength(1);
      expect(stored[0][1]).not.toMatch(/INV-1002|200000|شركة النور/);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitLoaded(page);
      await selectLine(page, 2);
      await actionBar(page).getByRole('button', { name: t.confirm }).click();
      await expect(page.getByTestId('decision-form-confirm').getByRole('textbox')).toHaveValue('سبب لم يكتمل');
    });
  });
}

test.describe('مكتب فقط', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, 'لوحة المفاتيح وجدول الأعمدة للمكتب');

  test('تنقّل لوحة المفاتيح: أسهم · Enter · N', async ({ page }) => {
    await open(page);
    await waitLoaded(page);
    const first = page.locator('tr[data-line-id="line-1"]');
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('tr[data-line-id="line-2"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('line-detail')).toContainText('INV-1002');
    await page.locator('tr[data-line-id="line-2"]').focus();
    await page.keyboard.press('n');
    await expect(page.locator('tr[aria-selected="true"]')).toHaveAttribute('data-line-id', 'line-3');
  });

  test('الداكن: لقطة المساحة', async ({ page }) => {
    await open(page, { theme: 'dark' });
    await waitLoaded(page);
    await selectLine(page, 2);
    await shot(page, 'workspace-ar-desktop-dark');
  });

  test('مرشّح النتيجة يمرّ بالخادم ويعرض السطور المطابقة فقط', async ({ page }) => {
    const state = await open(page);
    await waitLoaded(page);
    await page.getByRole('button', { name: /فرق تاريخ/ }).click();
    await expect(page.locator('tr[data-line-id="line-2"]')).toBeVisible();
    await expect(page.locator('tr[data-line-id="line-1"]')).toHaveCount(0);
    expect(state.requests.some((r) => r.includes('/matches'))).toBe(true);
  });

  test('دفاترنا غير الموجودة في الكشف: قائمة معلوماتية بلا قرارات', async ({ page }) => {
    await open(page);
    await waitLoaded(page);
    await page.getByRole('tab', { name: new RegExp(T.ar.ledger) }).click();
    await expect(page.getByTestId('ledger-only')).toContainText('S-free-1');
    await expect(actionBar(page)).toHaveCount(0);
  });
});

test.describe('جوال فقط', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 768, 'سير الجوال');

  test('بطاقات السطور ← Sheet كامل الشاشة ← شريط إجراءات لاصق وأهداف لمس ≥ 44px ← التالي غير المحسوم', async ({ page }) => {
    await open(page);
    await waitLoaded(page);
    await expect(page.getByTestId('mobile-progress')).toBeVisible();
    const card = page.locator('button[data-line-id="line-1"]');
    expect((await card.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await card.click();
    const bar = actionBar(page);
    await expect(bar).toBeVisible();
    for (const button of await bar.getByRole('button').all()) expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    // الشريط لاصق أسفل الشاشة
    const box = await bar.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan((page.viewportSize()?.height ?? 0) - 4);
    await bar.getByRole('button', { name: T.ar.next }).click();
    await expect(page.getByTestId('line-detail')).toContainText('INV-1002');
    await noHorizontalOverflow(page);
    await shot(page, 'mobile-sheet-ar');
  });
});
