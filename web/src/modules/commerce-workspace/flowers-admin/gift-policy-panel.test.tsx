// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/ui/toast';
import { renderIntl } from '@/test-utils/intl';
import { GiftPolicyPanel } from './gift-policy-panel';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const policy = (over: Record<string, unknown> = {}) => ({
  data: { gift_settings: { enabled: false, message_max_length: 250, allow_hide_sender: true, recipient_phone_required: true, ...over } },
});

function renderPanel(storeId = 's1') {
  return renderIntl(
    <ToastProvider>
      <GiftPolicyPanel storeId={storeId} locale="en" />
    </ToastProvider>,
    'en',
  );
}

describe('GiftPolicyPanel', () => {
  it('loads the persisted policy, starts clean and explains that off keeps values', async () => {
    apiMock.mockResolvedValueOnce(policy());
    renderPanel();

    const enabled = await screen.findByRole('switch', { name: 'Enable gifting' });
    expect(enabled.getAttribute('aria-checked')).toBe('false');
    expect((screen.getByLabelText('Maximum message length') as HTMLInputElement).value).toBe('250');
    expect(screen.getByText('All changes saved')).toBeTruthy();
    expect(screen.getByText(/Gifting is off/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/gift-settings');
  });

  it('marks the form dirty, mirrors the draft in the summary, and saves all four fields', async () => {
    apiMock.mockResolvedValueOnce(policy()).mockResolvedValueOnce(policy({ enabled: true, message_max_length: 120 }));
    renderPanel();
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable gifting' }));
    const length = screen.getByLabelText('Maximum message length');
    await userEvent.clear(length);
    await userEvent.type(length, '120');

    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByText('Card message up to 120 characters.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy());
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/storefronts/s1/gift-settings', {
      method: 'PUT',
      body: { is_enabled: true, message_max_length: 120, allow_hide_sender: true, recipient_phone_required: true },
    });
    expect(screen.getByRole('switch', { name: 'Enable gifting' }).getAttribute('aria-checked')).toBe('true');
  });

  it('refuses an invalid length locally with an described error and never calls the server', async () => {
    apiMock.mockResolvedValueOnce(policy());
    renderPanel();
    const length = await screen.findByLabelText('Maximum message length');
    await userEvent.clear(length);
    await userEvent.type(length, '900');
    fireEvent.blur(length);

    expect(length.getAttribute('aria-invalid')).toBe('true');
    expect(length.getAttribute('aria-describedby')).toContain('gift-length-error');
    expect(screen.getByText('Enter a whole number between 1 and 500.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('shows the server validation message and keeps the draft when saving fails', async () => {
    apiMock.mockResolvedValueOnce(policy()).mockRejectedValueOnce(new ApiError(422, 'الحد الأقصى خارج النطاق', { errors: {} }));
    renderPanel();
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable gifting' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('الحد الأقصى خارج النطاق')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Enable gifting' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('discard restores the saved values', async () => {
    apiMock.mockResolvedValueOnce(policy());
    renderPanel();
    await userEvent.click(await screen.findByRole('switch', { name: 'Allow hiding the sender name' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByText('All changes saved')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Allow hiding the sender name' }).getAttribute('aria-checked')).toBe('true');
  });

  it('offers retry on a failed load and a permission message on 403', async () => {
    apiMock.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(policy());
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('switch', { name: 'Enable gifting' })).toBeTruthy();

    cleanup();
    apiMock.mockReset();
    apiMock.mockRejectedValueOnce(new ApiError(403, 'forbidden', {}));
    renderPanel();
    expect(await screen.findByText(/do not have permission/)).toBeTruthy();
  });

  it('does not apply a late response from a previous store', async () => {
    let resolveFirst: (v: unknown) => void = () => undefined;
    apiMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(policy({ enabled: true }));
    const view = renderPanel('s1');
    view.rerender(
      <ToastProvider>
        <GiftPolicyPanel storeId="s2" locale="en" />
      </ToastProvider>,
    );
    expect((await screen.findByRole('switch', { name: 'Enable gifting' })).getAttribute('aria-checked')).toBe('true');
    resolveFirst(policy({ enabled: false }));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByRole('switch', { name: 'Enable gifting' }).getAttribute('aria-checked')).toBe('true');
  });
});
