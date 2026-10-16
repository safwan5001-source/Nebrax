// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { TEST_LOCALES, renderIntl, type TestLocale } from '@/test-utils/intl';
import { makeStatus } from '@/modules/intelligence/__tests__/fixtures';
import { api, canWith, resetSession, session } from './harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: session.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/intelligence/settings',
}));
vi.mock('@/lib/use-can', () => ({
  useCurrentUser: () => session.user,
  useCan: () => ({ can: canWith(session.user?.permissions ?? []), hydrated: true }),
}));
vi.mock('@/modules/intelligence/api', () => api);

import { IntelligenceProvider } from '@/modules/intelligence/store';
import { ConsentSettings } from '../consent-settings';

const mount = (locale: TestLocale = 'en') =>
  renderIntl(<IntelligenceProvider locale={locale}><ConsentSettings /></IntelligenceProvider>, locale);

const off = () => makeStatus({
  tenant: { enabled: false, consented_categories: [] },
  categories: [
    { key: 'assistant_messages', available: true, consented: false },
    { key: 'financial_summary', available: true, consented: false },
    { key: 'document_projected_text', available: false, consented: false },
  ],
  chat: 'tenant_disabled', financial: 'tenant_disabled', financial_tools: [],
});

beforeEach(() => resetSession());
afterEach(cleanup);

const sw = (name: RegExp | string) => screen.findByRole('switch', { name });

describe('access', () => {
  it('shows a denial (no controls) to someone without consent management', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus({ abilities: { use: true, manage_consent: false, view_audit: false, partner_detail: false } }));
    mount();
    await screen.findByText('This page is for the organization owner or admin');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it('offers retry when the status cannot be read', async () => {
    api.fetchStatus.mockRejectedValueOnce(new ApiError(500, 'x', null));
    mount();
    await screen.findByText('Server error');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe.each(TEST_LOCALES)('granting consent (%s)', (locale) => {
  const ar = locale === 'ar';

  it('requires an explicit acknowledgement before the master switch can be confirmed, then sends it', async () => {
    api.fetchStatus.mockResolvedValue(off());
    api.saveSettings.mockResolvedValue(makeStatus({ tenant: { enabled: true, consented_categories: [] }, financial_tools: [] }));
    mount(locale);
    await userEvent.click(await sw(ar ? 'تفعيل المساعد الذكي لمؤسستي' : 'Enable the assistant for my organization'));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: ar ? 'منح الموافقة' : 'Grant consent' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ enabled: true, consented_categories: [], acknowledge_privacy: true }));
    await waitFor(() => expect(screen.getByRole('status', { name: '' })).toBeTruthy());
  });

  it('grants a single category only after acknowledgement', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus({
      tenant: { enabled: true, consented_categories: ['assistant_messages'] },
      categories: [
        { key: 'assistant_messages', available: true, consented: true },
        { key: 'financial_summary', available: true, consented: false },
        { key: 'document_projected_text', available: false, consented: false },
      ],
      financial: 'consent_required',
    }));
    api.saveSettings.mockResolvedValue(makeStatus());
    mount(locale);
    await userEvent.click(await sw(ar ? /^الملخصات المالية/ : /^Financial summaries/));
    const dialog = await screen.findByRole('dialog');
    expect(api.saveSettings).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: ar ? 'منح الموافقة' : 'Grant consent' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      enabled: true, consented_categories: ['assistant_messages', 'financial_summary'], acknowledge_privacy: true,
    }));
  });

  it('keeps the document-text category unavailable and unswitchable (AI-04), and separates Document Center consent', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount(locale);
    const doc = (await sw(ar ? /^نص المستندات المستخرج/ : /^Extracted document text/)) as HTMLButtonElement;
    expect(doc.disabled).toBe(true);
    expect(screen.getByText(ar ? 'غير متاحة بعد' : 'Not available yet')).toBeTruthy();
    expect(screen.getByText(ar ? /موافقة مركز المستندات/ : /Document Center consent/)).toBeTruthy();
  });
});

describe('revoking and failures', () => {
  it('revokes a category immediately without an acknowledgement', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.saveSettings.mockResolvedValue(makeStatus({ tenant: { enabled: true, consented_categories: ['assistant_messages'] }, financial: 'consent_required' }));
    mount();
    await userEvent.click(await sw(/^Financial summaries/));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ enabled: true, consented_categories: ['assistant_messages'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disabling the assistant asks for confirmation and withdraws everything', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.saveSettings.mockResolvedValue(off());
    mount();
    await userEvent.click(await sw('Enable the assistant for my organization'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw consent' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ enabled: false, consented_categories: [] }));
  });

  it('blocks granting when the platform is off (revocation stays possible)', async () => {
    api.fetchStatus.mockResolvedValue({ ...off(), platform_enabled: false, chat: 'platform_disabled', financial: 'platform_disabled' });
    mount();
    const master = (await sw('Enable the assistant for my organization')) as HTMLButtonElement;
    expect(master.disabled).toBe(true);
    expect(screen.getByText('The platform has not turned this feature on yet. Nothing is sent and nothing is read. No action is needed from you.')).toBeTruthy();
  });

  it('shows the server refusal and does not pretend it saved', async () => {
    api.fetchStatus.mockResolvedValue(off());
    api.saveSettings.mockRejectedValue(new ApiError(422, 'x', { error: { code: 'acknowledgement_required', message: 'm' }, request_id: 'r' }));
    mount();
    await userEvent.click(await sw('Enable the assistant for my organization'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Grant consent' }));
    await waitFor(() => expect(document.querySelector('[data-notice="acknowledgement_required"]')).not.toBeNull());
    expect(screen.queryByText('Consent saved and effective immediately.')).toBeNull();
    expect((await sw('Enable the assistant for my organization')).getAttribute('aria-checked')).toBe('false');
  });

  it('shows the audit log only to someone with audit access, and never message text', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus({ abilities: { use: true, manage_consent: true, view_audit: true, partner_detail: true } }));
    api.fetchAuditEvents.mockResolvedValue([
      { id: 'e1', request_id: 'r1', actor_id: 'u1', event: 'consent.updated', tool: null, outcome: 'allowed', reason: 'ok', occurred_at: '2026-10-16 09:00:00' },
    ]);
    mount();
    await screen.findByText('consent.updated');
    expect(screen.getByText('The log never contains question or answer text.')).toBeTruthy();
  });

  it('does not request the audit log without audit access', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount();
    await sw('Enable the assistant for my organization');
    expect(api.fetchAuditEvents).not.toHaveBeenCalled();
  });
});
