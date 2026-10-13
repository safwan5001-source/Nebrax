/* @vitest-environment jsdom */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPlatformDetail, UnknownDeliveryPlatform } from './delivery-platform-detail';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import {
  deliveryLadder,
  deliveryPlatformKeys,
  readManualStatuses,
  readReadinessRows,
  type DeliveryAccess,
} from '@/lib/integration-center';

afterEach(cleanup);

const TODAY = [
  ['hungerstation', 'AWAITING_PROVIDER_APPROVAL', 'OWNER_GATE'], ['jahez', 'NOT_SUPPORTED', 'BLOCKED'], ['mrsool', 'NOT_SUPPORTED', 'BLOCKED'],
  ['keeta', 'AWAITING_PROVIDER_APPROVAL', 'OWNER_GATE'], ['ninja', 'NOT_SUPPORTED', 'BLOCKED'], ['the_chefz', 'NOT_SUPPORTED', 'BLOCKED'],
].map(([platform_key, ux_state, technical]) => ({
  platform_key, ux_state, technical, connect_enabled: false, sync_enabled: false,
  evidence_date: '2026-10-11', evidence_ref: `docs/plans/pos/DLV-PROVIDER-READINESS-1-REPORT.md §${platform_key}`,
}));
const PUBLIC_ONLY = TODAY.map(({ platform_key, ux_state, connect_enabled, sync_enabled }) => ({ platform_key, ux_state, connect_enabled, sync_enabled }));

function renderDetail(locale: TestLocale, key: string, over: Partial<{
  access: DeliveryAccess; loading: boolean; manualPayload: unknown; readinessPayload: unknown;
  manualFailed: boolean; readinessFailed: boolean; canOpenApplications: boolean;
  canManageProfiles: boolean; canViewHub: boolean; canViewReport: boolean; canViewEvidence: boolean; onRetry: () => void;
}> = {}) {
  const o = {
    access: 'allowed' as DeliveryAccess, loading: false,
    manualPayload: { data: [{ platform_key: 'keeta', is_active: true }] } as unknown,
    readinessPayload: { data: TODAY } as unknown,
    manualFailed: false, readinessFailed: false, canOpenApplications: false,
    canManageProfiles: true, canViewHub: true, canViewReport: true, canViewEvidence: true, onRetry: vi.fn(),
    ...over,
  };
  const manual = o.manualPayload === null ? null : readManualStatuses(o.manualPayload);
  const readiness = o.readinessPayload === null ? null : readReadinessRows(o.readinessPayload);
  const view = renderIntl(
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <DeliveryPlatformDetail
        platformKey={key}
        access={o.access}
        loading={o.loading}
        ladder={deliveryLadder(key, manual, readiness)}
        readiness={readiness?.get(key) ?? null}
        manualFailed={o.manualFailed}
        readinessFailed={o.readinessFailed}
        canOpenApplications={o.canOpenApplications}
        canManageProfiles={o.canManageProfiles}
        canViewHub={o.canViewHub}
        canViewReport={o.canViewReport}
        canViewEvidence={o.canViewEvidence}
        onRetry={o.onRetry}
      />
    </div>,
    locale,
  );
  return { ...view, props: o };
}

const ALLOWED_HREFS = new Set([
  '/integrations', '/integrations/delivery-platforms', '/delivery-platforms', '/delivery-hub',
  '/reports/sales/delivery-channel', '/applications',
]);

describe.each(TEST_LOCALES)('delivery platform detail (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].integrationCenter;

  it.each(deliveryPlatformKeys())('%s: four independent ladder rows from the readiness payload', (key) => {
    renderDetail(locale, key);

    const ladder = screen.getByTestId('capability-ladder');
    const rows = Array.from(ladder.querySelectorAll('[data-ladder-row]')).map((r) => r.getAttribute('data-ladder-row'));
    expect(rows).toEqual(['a', 'b', 'c', 'd']);
    const technical = TODAY.find((r) => r.platform_key === key)!.ux_state;
    const bText = technical === 'AWAITING_PROVIDER_APPROVAL' ? m.ladder.b.pending : m.ladder.b.unavailable;
    expect(ladder.querySelector('[data-ladder-step="b"]')?.textContent?.trim()).toBe(bText);
    expect(ladder.querySelector('[data-ladder-step="c"]')?.textContent?.trim()).toBe(m.ladder.downstream.blocked);
    expect(ladder.querySelector('[data-ladder-step="d"]')?.textContent?.trim()).toBe(m.ladder.downstream.blocked);
    expect(ladder.querySelector('[data-ladder-step="b"]')?.textContent?.trim()).not.toBe(m.ladder.b.available);
  });

  it.each(deliveryPlatformKeys())('%s: no connect, authorize, reconnect, sync or credential control exists (R-GATE-5/7)', (key) => {
    renderDetail(locale, key);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('input, select, textarea, form, [disabled], [aria-disabled="true"]')).toHaveLength(0);
    for (const a of screen.getAllByRole('link')) {
      expect(ALLOWED_HREFS.has(a.getAttribute('href') ?? '')).toBe(true);
      expect(a.textContent).not.toMatch(/connect|authori|sync|credential|ربط|تفويض|مزامنة|اعتماد/i);
    }
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\b(connect now|connect account|authori[sz]e|oauth|reconnect|start sync|sync now|enter credentials|api key|secret|token)\b/i);
    expect(text).not.toMatch(/(^|\s)(اربط|زامن|فوّض|فوض)(\s|$)|ربط الآن|أعد الربط|إعادة الربط|ابدأ المزامنة|بدء المزامنة|أدخل بيانات|مفتاح API/);
  });

  it('manual attribution is independent: set while native is pending, and unset (absent data) while blocked', () => {
    const { unmount } = renderDetail(locale, 'keeta');
    let ladder = screen.getByTestId('capability-ladder');
    expect(ladder.querySelector('[data-ladder-step="a"]')?.textContent?.trim()).toBe(m.ladder.a.set);
    expect(ladder.querySelector('[data-ladder-step="b"]')?.textContent?.trim()).toBe(m.ladder.b.pending);
    unmount();

    renderDetail(locale, 'jahez', { manualPayload: { data: [] } });
    ladder = screen.getByTestId('capability-ladder');
    expect(ladder.querySelector('[data-ladder-step="a"]')?.textContent?.trim()).toBe(m.ladder.a.unset);
    expect(ladder.textContent).toContain(m.ladder.a.desc_unset);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('distinguishes the signed event ingress from a connected merchant account', () => {
    renderDetail(locale, 'hungerstation');

    const note = screen.getByTestId('ingress-note');
    const platform = locale === 'ar' ? 'هنقرستيشن' : 'HungerStation';
    expect(note.textContent).toContain(m.detail.ingressTitle);
    expect(note.textContent).toContain(m.detail.ingressBody.replace('{platform}', platform));
    expect(within(note).queryAllByRole('link')).toHaveLength(0);
  });

  it('explains what works today with links gated by the viewer\'s permissions', () => {
    const { unmount } = renderDetail(locale, 'keeta');
    const list = screen.getByTestId('works-today');
    expect(within(list).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/delivery-platforms', '/delivery-hub', '/reports/sales/delivery-channel',
    ]);
    unmount();

    renderDetail(locale, 'keeta', { canViewHub: false, canViewReport: false });
    expect(within(screen.getByTestId('works-today')).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/delivery-platforms']);
  });

  // مصفوفة ظهور الروابط الثلاثة: إعداد الملف (`company.manage`) · صندوق التوصيل (`delivery_hub.view`) · التقرير (`reports.view`).
  it.each([
    ['owner / admin (all three)', { canManageProfiles: true, canViewHub: true, canViewReport: true }, ['/delivery-platforms', '/delivery-hub', '/reports/sales/delivery-channel']],
    ['accountant / staff (report only)', { canManageProfiles: false, canViewHub: false, canViewReport: true }, ['/reports/sales/delivery-channel']],
    ['custom: manage only', { canManageProfiles: true, canViewHub: false, canViewReport: false }, ['/delivery-platforms']],
    ['custom: hub only', { canManageProfiles: false, canViewHub: true, canViewReport: false }, ['/delivery-hub']],
    ['custom: none of the three', { canManageProfiles: false, canViewHub: false, canViewReport: false }, []],
  ])('link visibility matrix — %s', (_label, perms, hrefs) => {
    renderDetail(locale, 'keeta', perms);

    const links = within(screen.getByTestId('works-today')).queryAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(hrefs);
    // الرابط المحجوب يغيب فعلاً من الشجرة (لا مخفياً بـCSS ولا معطّلاً).
    expect(document.querySelectorAll('[disabled],[aria-disabled]')).toHaveLength(0);
  });

  it('a viewer who cannot manage profiles sees the fact plus a permission hint instead of a setup link', () => {
    renderDetail(locale, 'keeta', { canManageProfiles: false });

    const list = screen.getByTestId('works-today');
    expect(list.textContent).toContain(m.detail.worksPos);
    expect(within(list).getByTestId('setup-needs-permission').textContent).toBe(m.detail.setupNeedsPermission);
    expect(within(list).queryByRole('link', { name: m.detail.worksPosLink })).toBeNull();
  });

  it('a manager sees the setup link and no permission hint', () => {
    renderDetail(locale, 'keeta', { canManageProfiles: true });

    const list = screen.getByTestId('works-today');
    expect(within(list).getByRole('link', { name: m.detail.worksPosLink }).getAttribute('href')).toBe('/delivery-platforms');
    expect(within(list).queryByTestId('setup-needs-permission')).toBeNull();
  });

  it('the manual-attribution value is shown for every viewer regardless of the links they may follow', () => {
    renderDetail(locale, 'keeta', { canManageProfiles: false, canViewHub: false, canViewReport: false });

    const a = screen.getByTestId('capability-ladder').querySelector('[data-ladder-step="a"]');
    expect(a?.textContent?.trim()).toBe(m.ladder.a.set);
  });

  it('lists the three prerequisites as not yet available, and states the Hub-only boundary', () => {
    renderDetail(locale, 'keeta');

    const requires = screen.getByTestId('requires-list');
    expect(within(requires).getAllByRole('listitem')).toHaveLength(3);
    expect(requires.textContent).toContain(m.detail.requires.agreement);
    expect(requires.textContent).toContain(m.detail.requires.testAccess);
    expect(requires.textContent).toContain(m.detail.requires.spec);
    expect(requires.textContent?.split(m.detail.requiresNotYet).length).toBe(4);
    expect(screen.getByTestId('detail-boundaries').textContent).toContain(m.detail.hubOnlyNote);
  });

  it('a malformed evidence field is hidden with a visible note (owner/admin only), the valid ones stay, and no status changes', () => {
    const malformed = { data: TODAY.map((row) => (row.platform_key === 'keeta' ? { ...row, technical: 7, evidence_date: '2026-10-11', evidence_ref: 'docs/x.md' } : row)) };
    renderDetail(locale, 'keeta', { readinessPayload: malformed });

    const advanced = screen.getByTestId('detail-advanced');
    expect(advanced.textContent).not.toContain(m.detail.advanced.technical);
    expect(advanced.textContent).toContain('2026-10-11');
    expect(advanced.textContent).toContain('docs/x.md');
    expect(within(advanced).getByTestId('detail-advanced-malformed').textContent).toBe(m.detail.advanced.malformed);
    expect(screen.getByTestId('capability-ladder').querySelector('[data-ladder-step="b"]')?.textContent?.trim()).toBe(m.ladder.b.pending);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('when every evidence field is malformed the section shows only the note, still without any alert', () => {
    const all = { data: TODAY.map((row) => ({ ...row, technical: '', evidence_date: 'nope', evidence_ref: 5 })) };
    renderDetail(locale, 'keeta', { readinessPayload: all });

    const advanced = screen.getByTestId('detail-advanced');
    expect(advanced.querySelectorAll('dt')).toHaveLength(0);
    expect(within(advanced).getByTestId('detail-advanced-malformed')).toBeTruthy();
    expect(screen.getByTestId('capability-ladder').querySelector('[data-ladder-step="b"]')?.textContent?.trim()).toBe(m.ladder.b.pending);
  });

  it('a viewer without the evidence permission never sees the section or the note, even if the payload is malformed', () => {
    const all = { data: TODAY.map((row) => ({ ...row, technical: 7 })) };
    renderDetail(locale, 'keeta', { readinessPayload: all, canViewEvidence: false });

    expect(screen.queryByTestId('detail-advanced')).toBeNull();
    expect(screen.queryByTestId('detail-advanced-malformed')).toBeNull();
  });

  it('internal evidence fields appear only for a viewer who received them', () => {
    const { unmount } = renderDetail(locale, 'keeta');
    const advanced = screen.getByTestId('detail-advanced');
    expect(advanced.textContent).toContain('OWNER_GATE');
    expect(advanced.textContent).toContain('2026-10-11');
    expect(advanced.textContent).toContain('DLV-PROVIDER-READINESS-1-REPORT.md');
    unmount();

    // الخادم لا يرسل الحقول لغير المصرَّح لهم، فلا قسم متقدم حتى لو ادّعت الواجهة الصلاحية.
    renderDetail(locale, 'keeta', { readinessPayload: { data: PUBLIC_ONLY }, canViewEvidence: true });
    expect(screen.queryByTestId('detail-advanced')).toBeNull();
    cleanup();
    renderDetail(locale, 'keeta', { canViewEvidence: false });
    expect(screen.queryByTestId('detail-advanced')).toBeNull();
    expect(document.body.textContent).not.toContain('OWNER_GATE');
  });

  it('has the breadcrumb back to the catalog and to the Integration Center', () => {
    renderDetail(locale, 'ninja');

    const crumb = screen.getByTestId('integration-breadcrumb');
    expect(within(crumb).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/integrations', '/integrations/delivery-platforms']);
    expect(crumb.querySelector('[aria-current="page"]')?.textContent).toBe(locale === 'ar' ? 'نينجا' : 'Ninja');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(locale === 'ar' ? 'نينجا' : 'Ninja');
  });

  it('loading: skeleton only', () => {
    renderDetail(locale, 'keeta', { loading: true });

    expect(screen.getByRole('status', { name: m.detail.loading }).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('capability-ladder')).toBeNull();
  });

  it('permission denied and application off: restricted notice, no ladder, back link', () => {
    const { unmount } = renderDetail(locale, 'keeta', { access: 'denied' });
    expect(screen.getByRole('note').textContent).toBe(m.delivery.denied);
    expect(screen.queryByTestId('capability-ladder')).toBeNull();
    expect(within(screen.getByTestId('integration-restricted')).getByRole('link', { name: m.backToCenter }).getAttribute('href')).toBe('/integrations');
    unmount();

    renderDetail(locale, 'keeta', { access: 'app_off', canOpenApplications: false });
    expect(screen.getByRole('note').textContent).toBe(m.delivery.appOff);
    expect(within(screen.getByTestId('integration-restricted')).queryByRole('link', { name: m.delivery.manageApplications })).toBeNull();
    // «العودة إلى مركز التكاملات» تقود إلى المركز نفسه لا إلى كتالوج مقيَّد آخر.
    expect(within(screen.getByTestId('integration-restricted')).getByRole('link', { name: m.backToCenter }).getAttribute('href')).toBe('/integrations');
  });

  it('API failure: unreadable values, an alert, retry — never a success state or "none available"', async () => {
    const user = userEvent.setup();
    const { props } = renderDetail(locale, 'keeta', { manualPayload: null, readinessPayload: null, manualFailed: true, readinessFailed: true });

    const ladder = screen.getByTestId('capability-ladder');
    expect(ladder.querySelector('[data-ladder-step="a"]')?.textContent?.trim()).toBe(m.ladder.a.unreadable);
    expect(ladder.querySelector('[data-ladder-step="b"]')?.textContent?.trim()).toBe(m.ladder.b.unreadable);
    expect(ladder.textContent).not.toContain(m.ladder.b.unavailable);
    expect(ladder.textContent).not.toContain(m.ladder.a.unset);
    expect(ladder.textContent).toContain(m.ladder.b.desc_unreadable);
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: m.retry }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  const patchedKeeta = (patch: Record<string, unknown>) => ({ data: TODAY.map((row) => (row.platform_key === 'keeta' ? { ...row, ...patch } : row)) });

  it('a contradictory readiness row is unreadable, not available', () => {
    renderDetail(locale, 'keeta', { readinessPayload: patchedKeeta({ ux_state: 'READY_TO_CONNECT' }) });

    const b = screen.getByTestId('capability-ladder').querySelector('[data-ladder-step="b"]');
    expect(b?.textContent?.trim()).toBe(m.ladder.b.unreadable);
  });

  it('the prerequisites list follows rung B: "not yet" while unavailable or pending, hidden once available, "could not be read" when unreadable', () => {
    const { unmount } = renderDetail(locale, 'keeta');
    expect(screen.getByTestId('requires-list').textContent).toContain(m.detail.requiresNotYet);
    unmount();

    const ready = renderDetail(locale, 'keeta', { readinessPayload: patchedKeeta({ ux_state: 'READY_TO_CONNECT', connect_enabled: true }) });
    expect(screen.getByTestId('capability-ladder').querySelector('[data-ladder-step="b"]')?.textContent?.trim()).toBe(m.ladder.b.available);
    expect(screen.queryByTestId('requires-list')).toBeNull();
    expect(document.body.textContent).not.toContain(m.detail.requiresNotYet);
    ready.unmount();

    renderDetail(locale, 'keeta', { readinessPayload: patchedKeeta({ ux_state: 'READY_TO_CONNECT' }) });
    const requires = screen.getByTestId('requires-list');
    expect(requires.textContent).not.toContain(m.detail.requiresNotYet);
    expect(requires.textContent?.split(m.ladder.b.unreadable).length).toBe(4);
  });
});

describe.each(TEST_LOCALES)('unknown delivery platform (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].integrationCenter;

  it('shows a not-found page with a way back, and no ladder or data', () => {
    renderIntl(<UnknownDeliveryPlatform />, locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(m.detail.unknownTitle);
    expect(screen.getByRole('note').textContent).toBe(m.detail.unknownBody);
    expect(screen.getByRole('link', { name: m.detail.backToCatalog }).getAttribute('href')).toBe('/integrations/delivery-platforms');
    expect(screen.queryByTestId('capability-ladder')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
