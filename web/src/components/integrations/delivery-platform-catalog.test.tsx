/* @vitest-environment jsdom */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPlatformCatalog } from './delivery-platform-catalog';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import {
  deliveryLadder,
  deliveryPlatformKeys,
  readManualStatuses,
  readReadinessRows,
  type DeliveryAccess,
  type DeliveryLadder,
} from '@/lib/integration-center';

afterEach(cleanup);

const TODAY = [
  ['hungerstation', 'AWAITING_PROVIDER_APPROVAL'], ['jahez', 'NOT_SUPPORTED'], ['mrsool', 'NOT_SUPPORTED'],
  ['keeta', 'AWAITING_PROVIDER_APPROVAL'], ['ninja', 'NOT_SUPPORTED'], ['the_chefz', 'NOT_SUPPORTED'],
].map(([platform_key, ux_state]) => ({ platform_key, ux_state, connect_enabled: false, sync_enabled: false }));

function ladders(manualPayload: unknown, readinessPayload: unknown = { data: TODAY }): DeliveryLadder[] {
  const manual = manualPayload === null ? null : readManualStatuses(manualPayload);
  const readiness = readinessPayload === null ? null : readReadinessRows(readinessPayload);
  return deliveryPlatformKeys().map((key) => deliveryLadder(key, manual, readiness));
}

function renderCatalog(locale: TestLocale, over: Partial<{
  access: DeliveryAccess; loading: boolean; ladders: DeliveryLadder[]; manualFailed: boolean; readinessFailed: boolean;
  canOpenApplications: boolean; onRetry: () => void;
}> = {}) {
  const props = {
    access: 'allowed' as DeliveryAccess,
    loading: false,
    ladders: ladders({ data: [{ platform_key: 'keeta', is_active: true }, { platform_key: 'jahez', is_active: false }] }),
    manualFailed: false,
    readinessFailed: false,
    canOpenApplications: false,
    onRetry: vi.fn(),
    ...over,
  };
  const view = renderIntl(<div dir={locale === 'ar' ? 'rtl' : 'ltr'}><DeliveryPlatformCatalog {...props} /></div>, locale);
  return { ...view, props };
}

describe.each(TEST_LOCALES)('delivery platform catalog (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].integrationCenter;
  const names = locale === 'ar'
    ? ['هنقرستيشن', 'جاهز', 'مرسول', 'كيتا', 'نينجا', 'ذا شيفز']
    : ['HungerStation', 'Jahez', 'Mrsool', 'Keeta', 'Ninja', 'The Chefz'];

  it('lists exactly the six platforms in the central registry order, with the four ladder columns', () => {
    renderCatalog(locale);

    const table = screen.getByTestId('catalog-table');
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.getAttribute('data-platform'));
    expect(rows).toEqual(['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz']);
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(headers.slice(0, 5)).toEqual([m.catalog.columns.platform, m.ladder.a.label, m.ladder.b.label, m.ladder.c.label, m.ladder.d.label]);
    for (const name of names) expect(within(table).getByText(name)).toBeTruthy();
  });

  it('shows today\'s readiness: HungerStation and Keeta pending, the other four not available, none available', () => {
    renderCatalog(locale);

    const bOf = (key: string) => screen.getByTestId('catalog-table').querySelector(`tr[data-platform="${key}"] [data-ladder-step="b"]`)?.textContent?.trim();
    expect(bOf('hungerstation')).toBe(m.ladder.b.pending);
    expect(bOf('keeta')).toBe(m.ladder.b.pending);
    for (const key of ['jahez', 'mrsool', 'ninja', 'the_chefz']) expect(bOf(key)).toBe(m.ladder.b.unavailable);
    const bValues = Array.from(document.querySelectorAll('[data-ladder-step="b"]')).map((el) => el.textContent?.trim());
    expect(bValues).not.toContain(m.ladder.b.available);
  });

  it('keeps manual attribution independent from native readiness', () => {
    renderCatalog(locale);

    const cell = (key: string, step: string) => screen.getByTestId('catalog-table').querySelector(`tr[data-platform="${key}"] [data-ladder-step="${step}"]`)?.textContent?.trim();
    expect(cell('keeta', 'a')).toBe(m.ladder.a.set);
    expect(cell('keeta', 'b')).toBe(m.ladder.b.pending);
    expect(cell('jahez', 'a')).toBe(m.ladder.a.disabled);
    expect(cell('ninja', 'a')).toBe(m.ladder.a.unset);
  });

  it('merchant account and order sync always read "unavailable until a native integration exists" for blocked providers', () => {
    renderCatalog(locale);

    const table = screen.getByTestId('catalog-table');
    const downstream = table.querySelectorAll('[data-ladder-step="c"], [data-ladder-step="d"]');
    expect(downstream).toHaveLength(12);
    for (const el of Array.from(downstream)) expect(el.textContent?.trim()).toBe(m.ladder.downstream.blocked);
    expect(table.textContent).not.toMatch(/0\s*(connected|متصل)/i);
  });

  it('every row links only to its own detail page; nothing else is interactive but navigation', () => {
    renderCatalog(locale);

    const table = screen.getByTestId('catalog-table');
    const hrefs = within(table).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(deliveryPlatformKeys().map((key) => `/integrations/delivery-platforms/${key}`));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('input, select, textarea, form')).toHaveLength(0);
  });

  it('renders the same data as cards for small screens', () => {
    renderCatalog(locale);

    const cards = screen.getByTestId('catalog-cards');
    expect(Array.from(cards.querySelectorAll(':scope > li')).map((li) => li.getAttribute('data-platform'))).toEqual(deliveryPlatformKeys());
    expect(within(cards).getAllByRole('link')).toHaveLength(6);
    expect(cards.querySelectorAll('[data-ladder-step]')).toHaveLength(24);
  });

  it('has a breadcrumb back to the Integration Center and a table caption', () => {
    renderCatalog(locale);

    const crumb = screen.getByTestId('integration-breadcrumb');
    expect(within(crumb).getByRole('link', { name: m.title }).getAttribute('href')).toBe('/integrations');
    expect(crumb.querySelector('[aria-current="page"]')?.textContent).toBe(m.catalog.title);
    expect(screen.getByTestId('catalog-table').querySelector('caption')?.textContent).toBe(m.catalog.caption);
  });

  it('loading: skeleton, no rows, no links to platforms', () => {
    renderCatalog(locale, { loading: true });

    expect(screen.getByRole('status', { name: m.catalog.loading }).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('catalog-table')).toBeNull();
    expect(screen.queryAllByRole('link', { name: new RegExp(names[0]) })).toHaveLength(0);
  });

  it('permission denied and application off are restricted notices with no data', () => {
    const { unmount } = renderCatalog(locale, { access: 'denied' });
    expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('denied');
    expect(screen.getByRole('note').textContent).toBe(m.delivery.denied);
    expect(screen.queryByTestId('catalog-table')).toBeNull();
    unmount();

    renderCatalog(locale, { access: 'app_off', canOpenApplications: true });
    expect(screen.getByRole('note').textContent).toBe(m.delivery.appOff);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toContain('/applications');
    expect(screen.queryByTestId('catalog-table')).toBeNull();
  });

  it('a partial failure marks only the unreadable column and never turns it into success or "none"', () => {
    renderCatalog(locale, { ladders: ladders(null), manualFailed: true });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(m.catalog.partialError);
    const table = screen.getByTestId('catalog-table');
    for (const el of Array.from(table.querySelectorAll('[data-ladder-step="a"]'))) {
      expect(el.textContent?.trim()).toBe(m.ladder.a.unreadable);
    }
    expect(table.querySelector('tr[data-platform="keeta"] [data-ladder-step="b"]')?.textContent?.trim()).toBe(m.ladder.b.pending);
  });

  it('a readiness failure makes B, C and D unreadable — never "not available"', () => {
    renderCatalog(locale, { ladders: ladders({ data: [] }, null), readinessFailed: true });

    const table = screen.getByTestId('catalog-table');
    for (const step of ['b', 'c', 'd']) {
      for (const el of Array.from(table.querySelectorAll(`[data-ladder-step="${step}"]`))) {
        expect(el.textContent?.trim()).toBe(step === 'b' ? m.ladder.b.unreadable : m.ladder.downstream.unreadable);
      }
    }
    expect(table.textContent).not.toContain(m.ladder.b.unavailable);
    expect(table.textContent).not.toContain(m.ladder.downstream.blocked);
  });

  it('both reads failing shows the total-failure message and retry calls back', async () => {
    const user = userEvent.setup();
    const { props } = renderCatalog(locale, { ladders: ladders(null, null), manualFailed: true, readinessFailed: true });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(m.catalog.loadError);
    await user.click(within(alert).getByRole('button', { name: m.retry }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    // الزر الوحيد في الصفحة هو «إعادة المحاولة».
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('never offers connect, authorize, reconnect, sync or credentials — not even disabled', () => {
    renderCatalog(locale);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('input, select, textarea, form, [disabled], [aria-disabled="true"]')).toHaveLength(0);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\b(connect now|connect account|authori[sz]e|oauth|reconnect|start sync|sync now|enter credentials|api key|secret|token)\b/i);
    expect(text).not.toMatch(/(^|\s)(اربط|زامن|فوّض|فوض)(\s|$)|ربط الآن|أعد الربط|إعادة الربط|ابدأ المزامنة|بدء المزامنة|أدخل بيانات|مفتاح API/);
  });

  it('uses logical direction only and no key leaks', () => {
    renderCatalog(locale);

    expect(document.body.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d|text-(left|right)\b/);
    expect(document.body.textContent ?? '').not.toContain('integrationCenter.');
  });
});
