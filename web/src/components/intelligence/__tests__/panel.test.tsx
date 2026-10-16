// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { TEST_LOCALES, renderIntl, type TestLocale } from '@/test-utils/intl';
import { blockedStatus, makeStatus, messageResponse } from '@/modules/intelligence/__tests__/fixtures';
import { api, canWith, resetSession, session } from './harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: session.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => session.pathname,
}));
vi.mock('@/lib/use-can', () => ({
  useCurrentUser: () => session.user,
  useCan: () => ({ can: canWith(session.user?.permissions ?? []), hydrated: true }),
}));
vi.mock('@/modules/intelligence/api', () => api);

import { IntelligenceProvider, useIntelligence } from '@/modules/intelligence/store';
import { AssistantPanel } from '../assistant-panel';
import { AssistantTrigger } from '../assistant-trigger';

function Opener() {
  const { openPanel } = useIntelligence();
  return <button type="button" onClick={openPanel}>open-panel</button>;
}

function mount(locale: TestLocale = 'en') {
  return renderIntl(
    <IntelligenceProvider locale={locale}><AssistantTrigger /><Opener /><AssistantPanel /></IntelligenceProvider>,
    locale,
  );
}

async function openPanel() {
  await userEvent.click(screen.getByRole('button', { name: 'open-panel' }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  resetSession();
  // الاختبار يفترض مؤشراً غير لمسي: لا نعتمد على حالة matchMedia المتروكة من ملفات أخرى في العملية المشتركة.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('trigger visibility', () => {
  it('is hidden from users without ai.assistant.use', () => {
    resetSession(['invoices.view']);
    mount();
    expect(screen.queryByRole('button', { name: 'AWJ assistant' })).toBeNull();
  });
  it('is shown to users who can use the assistant', () => {
    resetSession(['ai.assistant.use']);
    mount();
    expect(screen.getByRole('button', { name: 'AWJ assistant' }).getAttribute('aria-haspopup')).toBe('dialog');
  });
});

describe('opening', () => {
  it('reads the status on open, makes no chat/financial request and labels the provider as demo', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount();
    const dialog = await openPanel();
    await waitFor(() => expect(within(dialog).getByText('Ask about your numbers, from your reports')).toBeTruthy());
    expect(api.fetchStatus).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.runTool).not.toHaveBeenCalled();
    expect(within(dialog).getAllByText('Demo').length).toBeGreaterThan(0);
  });

  it('shows only approved page metadata as context (screen kind + short id) and orders suggestions by page', async () => {
    session.pathname = '/reports/customers/aging';
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount();
    const dialog = await openPanel();
    await waitFor(() => expect(within(dialog).getByText('Receivables aging report')).toBeTruthy());
    const group = within(dialog).getByRole('group', { name: 'Suggestions' });
    const names = within(group).getAllByRole('button').map((b) => b.textContent);
    expect(names[0]).toBe('Receivables aging'); // this screen's report first
    expect(within(group).getByText('Suggested for this screen')).toBeTruthy();
    expect(within(group).getByText('Other reports')).toBeTruthy();
    // unsupported analysis is stated, never offered as a button
    expect(within(dialog).getByText(/Not available yet: period comparison, charts/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /compare|chart/i })).toBeNull();
  });

  it('puts keyboard focus in the composer on open (non-touch)', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount();
    const dialog = await openPanel();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByPlaceholderText('Ask about the income statement or aging…')), { timeout: 5000 });
  });
});

describe('focus return', () => {
  it('returns focus to the element that opened the panel', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount();
    const opener = screen.getByRole('button', { name: 'open-panel' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('re-opening', () => {
  it('focuses the composer again on a second open when the status is already known', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount();
    const dialog = await openPanel();
    await waitFor(() => expect(document.activeElement?.tagName).toBe('TEXTAREA'), { timeout: 5000 });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const again = await openPanel();
    await waitFor(() => expect(document.activeElement).toBe(within(again).getByRole('textbox')), { timeout: 5000 });
    expect(api.fetchStatus).toHaveBeenCalledTimes(2); // fresh read on every open
  });
});

describe.each(TEST_LOCALES)('blocked states (%s)', (locale) => {
  it.each(['platform_disabled', 'tenant_disabled', 'consent_required', 'permission_denied', 'provider_unavailable'] as const)(
    '%s: shows the real state, disables the composer and sends nothing',
    async (state) => {
      api.fetchStatus.mockResolvedValue(blockedStatus(state));
      mount(locale);
      const dialog = await openPanel();
      await waitFor(() => expect(within(dialog).getByRole(state === 'permission_denied' ? 'status' : 'status').getAttribute('data-notice')).toBe(state));
      const composer = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
      expect(composer.disabled).toBe(true);
      fireEvent.keyDown(composer, { key: 'Enter' });
      expect(api.sendMessage).not.toHaveBeenCalled();
      expect(api.runTool).not.toHaveBeenCalled();
    },
  );

  it('links consent_required to the settings page for an admin, and only advises others', async () => {
    api.fetchStatus.mockResolvedValue(blockedStatus('consent_required'));
    mount(locale);
    const dialog = await openPanel();
    await waitFor(() => expect(within(dialog).getByRole('link').getAttribute('href')).toBe('/intelligence/settings'));
    cleanup();
    api.fetchStatus.mockResolvedValue(blockedStatus('consent_required', { abilities: { use: true, manage_consent: false, view_audit: false, partner_detail: false } }));
    mount(locale);
    const second = await openPanel();
    await waitFor(() => expect(within(second).getByRole('status').getAttribute('data-notice')).toBe('consent_required'));
    expect(within(second).queryByRole('link')).toBeNull();
  });

  it('offers retry when the status read itself fails', async () => {
    api.fetchStatus.mockRejectedValueOnce(new ApiError(500, 'x', null)).mockResolvedValueOnce(makeStatus());
    mount(locale);
    const dialog = await openPanel();
    const retry = await within(dialog).findByRole('button', { name: locale === 'ar' ? 'إعادة المحاولة' : 'Try again' });
    await userEvent.click(retry);
    await waitFor(() => expect(within(dialog).getByRole('textbox')).toBeTruthy());
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
  });
});

describe('conversation', () => {
  it('sends a suggestion through the gateway, labels the reply as demo and links to the canvas and report', async () => {
    session.pathname = '/reports/general/income-statement';
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.sendMessage.mockResolvedValue(messageResponse());
    mount('en');
    const dialog = await openPanel();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Income statement this month' }));
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith({ message: 'Income statement', locale: 'en' }));
    await within(dialog).findByText('This is a deterministic mock response.');
    expect(within(dialog).getByText(/not an analysis from a real AI model/)).toBeTruthy();
    expect(dialog.textContent).toContain('8,345.00');
    expect(within(dialog).getByRole('link', { name: 'Open original report' }).getAttribute('href')).toBe('/reports/general/income-statement');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Open in Canvas' }));
    expect(session.push).toHaveBeenCalledWith('/intelligence');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Enter sends, Shift+Enter does not; the counter and limit are enforced', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.sendMessage.mockResolvedValue(messageResponse([]));
    mount('en');
    const dialog = await openPanel();
    const box = (await within(dialog).findByRole('textbox')) as HTMLTextAreaElement;
    await userEvent.type(box, 'hello');
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(api.sendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
    expect(box.value).toBe('');

    fireEvent.change(box, { target: { value: 'x'.repeat(2001) } });
    expect((within(dialog).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/longer than 2000/)).toBeTruthy();
  });

  it('turns a budget refusal into a real state, not a result', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.sendMessage.mockRejectedValue(new ApiError(429, 'x', { error: { code: 'budget_exceeded', message: 'm' }, request_id: 'r' }));
    mount('en');
    const dialog = await openPanel();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Income statement this month' }));
    await within(dialog).findByText('Assistant budget is used up');
    expect(within(dialog).queryByText(/Demo reply/)).toBeNull();
  });

  it('shows an honest line when the mock reply ran no report', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.sendMessage.mockResolvedValue(messageResponse([]));
    mount('en');
    const dialog = await openPanel();
    const box = await within(dialog).findByRole('textbox');
    await userEvent.type(box, 'hello{Enter}');
    await within(dialog).findByText(/No report was run for this question/);
  });

  it('clears the conversation and closes with Escape', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.sendMessage.mockResolvedValue(messageResponse([]));
    mount('en');
    const dialog = await openPanel();
    await userEvent.type(await within(dialog).findByRole('textbox'), 'hi{Enter}');
    await within(dialog).findByText('This is a deterministic mock response.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear conversation' }));
    expect(within(dialog).queryByText('This is a deterministic mock response.')).toBeNull();
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has a labelled back control for mobile and keeps the dialog accessible', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount('ar');
    const dialog = await openPanel();
    expect(within(dialog).getByRole('button', { name: 'رجوع إلى الصفحة' })).toBeTruthy();
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  });
});
