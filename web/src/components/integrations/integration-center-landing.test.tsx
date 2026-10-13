/* @vitest-environment jsdom */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationCenterLanding, type SummaryStatus } from './integration-center-landing';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import type { DeliveryAccess, DeliverySummary } from '@/lib/integration-center';

afterEach(cleanup);

const READY_SUMMARY: DeliverySummary = { setUp: 2, total: 6, nativeAvailable: 0 };

function renderLanding(
  locale: TestLocale,
  overrides: Partial<{
    access: DeliveryAccess;
    summary: DeliverySummary | null;
    summaryStatus: SummaryStatus;
    canOpenApplications: boolean;
    onRetry: () => void;
  }> = {},
) {
  const props = {
    access: 'allowed' as DeliveryAccess,
    summary: READY_SUMMARY as DeliverySummary | null,
    summaryStatus: 'ready' as SummaryStatus,
    canOpenApplications: false,
    onRetry: vi.fn(),
    ...overrides,
  };
  const view = renderIntl(
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <IntegrationCenterLanding {...props} />
    </div>,
    locale,
  );
  return { ...view, props };
}

describe.each(TEST_LOCALES)('Integration Center landing (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].integrationCenter;

  it('shows the title and four cards in the approved order', () => {
    renderLanding(locale);

    expect(screen.getByRole('heading', { level: 1, name: m.title })).toBeTruthy();
    const ids = Array.from(document.querySelectorAll('[data-testid^="integration-card-"]')).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual([
      'integration-card-delivery',
      'integration-card-ecommerce',
      'integration-card-payments',
      'integration-card-shipping',
    ]);
    for (const title of [m.delivery.title, m.ecommerce.title, m.payments.title, m.shipping.title]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
    }
  });

  it('delivery platforms enters the existing section and is the only link', () => {
    renderLanding(locale);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/delivery-platforms');
    expect(links[0].getAttribute('data-testid')).toBe('integration-card-delivery');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('the three future cards are structurally inert: no link, button, tabindex or interactive role', () => {
    renderLanding(locale);

    for (const key of ['ecommerce', 'payments', 'shipping']) {
      const card = screen.getByTestId(`integration-card-${key}`);
      expect(card.tagName).toBe('DIV');
      expect(card.getAttribute('data-inert')).toBe('true');
      expect(card.hasAttribute('tabindex')).toBe(false);
      expect(card.hasAttribute('role')).toBe(false);
      expect(card.hasAttribute('onclick')).toBe(false);
      expect(card.closest('a')).toBeNull();
      expect(card.querySelectorAll('a, button, input, select, textarea, [tabindex], [role="button"], [role="link"]')).toHaveLength(0);
      expect(within(card).getByText(m.planned)).toBeTruthy();
    }
    expect(screen.getByTestId('integration-center-planned-note').textContent).toBe(m.plannedNote);
  });

  it('keyboard: exactly one tab stop (the delivery card) and Enter is its only action', async () => {
    const user = userEvent.setup();
    renderLanding(locale);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('integration-card-delivery'));
    await user.tab();
    expect(document.body.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByTestId('integration-card-delivery'));
    expect(['ecommerce', 'payments', 'shipping'].some((key) => (
      screen.getByTestId(`integration-card-${key}`).contains(document.activeElement)
    ))).toBe(false);
  });

  it('the delivery link has an accessible name and description', () => {
    renderLanding(locale);

    const link = screen.getByRole('link', { name: m.delivery.title });
    expect(link.getAttribute('aria-describedby')).toBeTruthy();
    expect(link.textContent).toContain(m.delivery.description);
    expect(link.textContent).toContain(m.delivery.badge);
  });

  it('never offers connect, authorize or sync and makes no launch or partnership claim', () => {
    renderLanding(locale, { summary: { setUp: 1, total: 6, nativeAvailable: 0 } });

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\b(connect|authori[sz]e|oauth|sync|synchroni[sz]ation|official partner|coming soon|launch)\b/i);
    expect(text).not.toMatch(/(ربط|تفويض|مزامنة|شريك رسمي|قريباً|إطلاق|ضمن التصميم|القسم الأول)/);
    expect(screen.queryByRole('button', { name: /connect|ربط/i })).toBeNull();
  });

  it('the active badge is neutral, never the green financial tone', () => {
    renderLanding(locale);

    const badge = within(screen.getByTestId('integration-card-delivery')).getByText(m.delivery.badge);
    expect(badge.className).toContain('bg-primary-soft');
    expect(document.body.innerHTML).not.toMatch(/(text|bg|border)-positive/);
  });

  it('uses logical direction only: the chevron mirrors in RTL and no physical side classes appear', () => {
    renderLanding(locale);

    const chevron = screen.getByTestId('integration-card-delivery').querySelector('svg.rtl\\:rotate-180');
    expect(chevron).not.toBeNull();
    expect(document.body.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d|text-(left|right)\b/);
  });

  it('shows the A and B summary honestly: setup count, and none available when zero', () => {
    renderLanding(locale, { summary: { setUp: 2, total: 6, nativeAvailable: 0 } });

    const summary = screen.getByTestId('integration-center-summary');
    expect(summary.textContent).toContain(m.delivery.setUp.replace('{count}', '2').replace('{total}', '6'));
    expect(summary.textContent).toContain(m.delivery.nativeNone);
  });

  it('reports available native integrations only when some are actually ready', () => {
    renderLanding(locale, { summary: { setUp: 0, total: 6, nativeAvailable: 1 } });

    const summary = screen.getByTestId('integration-center-summary');
    expect(summary.textContent).toContain(m.delivery.nativeSome.replace('{count}', '1'));
    expect(summary.textContent).not.toContain(m.delivery.nativeNone);
  });

  it('omits an unreadable line instead of guessing it', () => {
    renderLanding(locale, { summary: { setUp: null, total: 6, nativeAvailable: 0 } });

    const summary = screen.getByTestId('integration-center-summary');
    expect(summary.textContent).toContain(m.delivery.nativeNone);
    expect(summary.textContent).not.toContain(m.delivery.setUp.replace('{count}', '0').replace('{total}', '6'));
    expect(summary.querySelectorAll('li')).toHaveLength(1);
  });

  it('loading: skeleton for the whole grid while access is being resolved, no links', () => {
    renderLanding(locale, { access: 'checking', summary: null, summaryStatus: 'loading' });

    const status = screen.getByRole('status', { name: m.loading });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByTestId('integration-card-delivery')).toBeNull();
    expect(screen.queryByTestId('integration-center-planned-note')).toBeNull();
  });

  it('summary loading keeps the card usable and shows placeholders only inside it', () => {
    renderLanding(locale, { summary: null, summaryStatus: 'loading' });

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByTestId('integration-center-summary-loading')).toBeTruthy();
    expect(screen.queryByTestId('integration-center-summary')).toBeNull();
  });

  it('summary error: a visible alert with retry, and the card still works', async () => {
    const user = userEvent.setup();
    const { props } = renderLanding(locale, { summary: null, summaryStatus: 'error' });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(m.summaryError);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    await user.click(within(alert).getByRole('button', { name: m.retry }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('permission denied: the delivery slot is inert with the denial message and no link at all', () => {
    renderLanding(locale, { access: 'denied', summary: null, summaryStatus: 'loading' });

    const card = screen.getByTestId('integration-card-delivery');
    expect(card.getAttribute('data-state')).toBe('denied');
    expect(card.tagName).toBe('DIV');
    expect(within(card).getByRole('note').textContent).toBe(m.delivery.denied);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByTestId('integration-center-summary')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('application off: inert with the message, and the applications link only for who may open it', () => {
    const { unmount } = renderLanding(locale, { access: 'app_off', canOpenApplications: false });
    const card = screen.getByTestId('integration-card-delivery');
    expect(card.getAttribute('data-state')).toBe('app_off');
    expect(within(card).getByRole('note').textContent).toBe(m.delivery.appOff);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    unmount();

    renderLanding(locale, { access: 'app_off', canOpenApplications: true });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/applications');
    expect(links[0].textContent).toBe(m.delivery.manageApplications);
  });

  it('never leaks a message key into the page', () => {
    renderLanding(locale, { summary: READY_SUMMARY });

    expect(document.body.textContent ?? '').not.toContain('integrationCenter.');
  });
});

describe('Integration Center copy reconciliation', () => {
  it('replaces the mock-up wording with neutral, non-promissory copy in both locales', () => {
    for (const locale of TEST_LOCALES) {
      const m = TEST_MESSAGES[locale].integrationCenter;
      const all = JSON.stringify(m);
      expect(all).not.toMatch(/(ضمن التصميم|القسم الأول|first section|in design)/i);
    }
    expect(TEST_MESSAGES.ar.integrationCenter.planned).toBe('توسع مستقبلي');
    expect(TEST_MESSAGES.ar.nav.integrations).toBe('مركز التكاملات');
    expect(TEST_MESSAGES.en.nav.integrations).toBe('Integration Center');
  });

  it('has the same key set in Arabic and English', () => {
    const keys = (node: unknown, prefix = ''): string[] =>
      node !== null && typeof node === 'object'
        ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
        : [prefix];
    expect(keys(TEST_MESSAGES.ar.integrationCenter).sort()).toEqual(keys(TEST_MESSAGES.en.integrationCenter).sort());
  });
});
