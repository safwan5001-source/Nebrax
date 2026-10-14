/* @vitest-environment jsdom */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommunicationsCatalog } from './communications-catalog';
import { COMMUNICATION_CHANNEL_ORDER, COMMUNICATION_PROVIDERS } from '@/lib/communications-providers';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

afterEach(cleanup);

describe.each(TEST_LOCALES)('Communications providers catalog (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].integrationCenter;

  it('lists every channel in order with every known provider and its status label', () => {
    renderIntl(<CommunicationsCatalog allowed />, locale);

    expect(screen.getByRole('heading', { level: 1, name: m.communications.title })).toBeTruthy();
    const channels = Array.from(document.querySelectorAll('[data-channel]')).map((el) => el.getAttribute('data-channel'));
    expect(channels).toEqual([...COMMUNICATION_CHANNEL_ORDER]);
    for (const provider of COMMUNICATION_PROVIDERS) {
      const card = screen.getByTestId(`communications-provider-${provider.key}`);
      expect(card.textContent).toContain(provider.name);
      expect(card.textContent).toContain(provider.vendor);
      expect(card.getAttribute('data-status')).toBe(provider.status);
      expect(card.textContent).toContain(m.communications.status[provider.status].label);
    }
  });

  it('states plainly that nothing is connected and the legend shows "actually connected" as empty', () => {
    renderIntl(<CommunicationsCatalog allowed />, locale);

    expect(screen.getByTestId('communications-truth-note').textContent).toBe(m.communications.truthNote);
    const connected = screen.getByTestId('communications-legend-connected');
    expect(connected.textContent).toContain(m.communications.legend.connected.label);
    expect(connected.textContent).toContain(m.communications.legend.connected.description);
    // لا بطاقة مزوّد تحمل تلك التسمية.
    for (const provider of COMMUNICATION_PROVIDERS) {
      expect(screen.getByTestId(`communications-provider-${provider.key}`).textContent).not.toContain(m.communications.legend.connected.label);
    }
    expect(document.querySelector('[data-status="connected"]')).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/(text|bg|border)-positive/);
  });

  it('has no control at all: no button, input, form; the only link is the breadcrumb', () => {
    renderIntl(<CommunicationsCatalog allowed />, locale);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('input, select, textarea, form, [tabindex]')).toHaveLength(0);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/integrations');
    expect(document.body.textContent ?? '').not.toMatch(/\b(connect|authori[sz]e|oauth|sync|api key|launch)\b/i);
    expect(document.body.textContent ?? '').not.toMatch(/(ربط|تفويض|مزامنة|مفتاح)/);
  });

  it('shows the official WhatsApp logo only, and the generic channel icon for every other provider', () => {
    renderIntl(<CommunicationsCatalog allowed />, locale);

    const imgs = Array.from(document.querySelectorAll('img'));
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual(['/brand/social/whatsapp.svg']);
    expect(imgs[0].getAttribute('alt')).toBe('');
    const wa = screen.getByTestId('communications-provider-whatsapp-business-platform');
    expect(wa.querySelector('[data-mark="official"]')).not.toBeNull();
    for (const provider of COMMUNICATION_PROVIDERS.filter((p) => p.logo.kind === 'generic')) {
      const card = screen.getByTestId(`communications-provider-${provider.key}`);
      expect(card.querySelector('[data-mark="generic"]'), provider.key).not.toBeNull();
      expect(card.querySelector('img')).toBeNull();
    }
    // لا يوجد hotlink: كل مصدر صورة مسار داخلي.
    for (const img of imgs) expect(img.getAttribute('src')).not.toMatch(/^(https?:)?\/\//);
  });

  it('a failed official asset falls back to the generic icon instead of a broken image', () => {
    renderIntl(<CommunicationsCatalog allowed />, locale);

    const wa = screen.getByTestId('communications-provider-whatsapp-business-platform');
    fireEvent.error(wa.querySelector('img')!);
    expect(wa.querySelector('img')).toBeNull();
    expect(wa.querySelector('[data-mark="generic"]')).not.toBeNull();
    expect(within(wa).getByText('WhatsApp Business Platform')).toBeTruthy();
  });

  it('status is never conveyed by colour alone: every status badge carries its text label and icon', () => {
    renderIntl(<CommunicationsCatalog allowed />, locale);

    for (const provider of COMMUNICATION_PROVIDERS) {
      const badge = within(screen.getByTestId(`communications-provider-${provider.key}`)).getByText(m.communications.status[provider.status].label);
      expect(badge.querySelector('svg')).not.toBeNull();
    }
  });

  it('uses logical direction only and mirrors nothing physical', () => {
    renderIntl(<CommunicationsCatalog allowed />, locale);

    expect(document.body.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d|text-(left|right)\b/);
  });

  it('denied: only the note and the way back; no provider is listed', () => {
    renderIntl(<CommunicationsCatalog allowed={false} />, locale);

    expect(screen.getByRole('note').textContent).toBe(m.communications.denied);
    expect(screen.queryByTestId('communications-truth-note')).toBeNull();
    expect(document.querySelectorAll('[data-testid^="communications-provider-"]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: m.backToCenter }).getAttribute('href')).toBe('/integrations');
  });

  it('never leaks a message key', () => {
    renderIntl(<CommunicationsCatalog allowed />, locale);

    expect(document.body.textContent ?? '').not.toContain('integrationCenter.');
    expect(document.body.textContent ?? '').not.toContain('communications.');
  });
});
