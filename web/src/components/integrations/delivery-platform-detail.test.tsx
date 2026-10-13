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
  canViewHub: boolean; canViewReport: boolean; canViewEvidence: boolean; onRetry: () => void;
}> = {}) {
  const o = {
    access: 'allowed' as DeliveryAccess, loading: false,
    manualPayload: { data: [{ platform_key: 'keeta', is_active: true }] } as unknown,
    readinessPayload: { data: TODAY } as unknown,
    manualFailed: false, readinessFailed: false, canOpenApplications: false,
    canViewHub: true, canViewReport: true, canViewEvidence: true, onRetry: vi.fn(),
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
    expect(within(screen.getByTestId('integration-restricted')).getByRole('link', { name: m.backToCenter }).getAttribute('href')).toBe('/integrations/delivery-platforms');
    unmount();

    renderDetail(locale, 'keeta', { access: 'app_off', canOpenApplications: false });
    expect(screen.getByRole('note').textContent).toBe(m.delivery.appOff);
    expect(within(screen.getByTestId('integration-restricted')).queryByRole('link', { name: m.delivery.manageApplications })).toBeNull();
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
