/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loadMock = vi.fn();
const saveMock = vi.fn();
const publishMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation', () => ({
  loadStorefrontPresentation: (...args: unknown[]) => loadMock(...args),
  saveStorefrontPresentation: (...args: unknown[]) => saveMock(...args),
  publishStorefrontPresentation: (...args: unknown[]) => publishMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

const record = {
  storefrontId: 'store-1',
  schemaVersion: 1,
  draft: DEFAULT_PRESENTATION_CONFIG,
  draftRevision: 0,
  published: null,
  publishedRevision: null,
  publishedAt: null,
};

describe('ExperienceBuilder persistence wiring', () => {
  afterEach(() => {
    cleanup();
    loadMock.mockReset();
    saveMock.mockReset();
    publishMock.mockReset();
  });

  it('loads the selected storefront draft on mount', async () => {
    loadMock.mockResolvedValue({ ok: true, data: record });
    render(
      <ExperienceBuilder
        storefrontId="store-1"
        initialLocale="en"
        liveStoreName="Al-Noor Store"
      />,
    );
    await waitFor(() => expect(loadMock).toHaveBeenCalledWith('store-1'));
    expect(screen.getByText('Store Experience Builder')).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('does not claim save success until PUT returns 200', async () => {
    loadMock.mockResolvedValue({ ok: true, data: record });
    saveMock.mockResolvedValue({
      ok: true,
      data: { ...record, draftRevision: 1 },
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][2]).toBe(0);
    expect(screen.getByRole('status').textContent).toMatch(/Draft saved/);
    expect(screen.queryByText(/nothing was stored/i)).toBeNull();
  });

  it('reloads on 409 instead of merging or claiming success', async () => {
    loadMock
      .mockResolvedValueOnce({ ok: true, data: record })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ...record,
          draftRevision: 2,
          draft: { ...DEFAULT_PRESENTATION_CONFIG, homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, heroHeadline: 'server' } },
        },
      });
    saveMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status').textContent).toMatch(/changed elsewhere/i);
    expect(screen.queryByText(/Draft saved/)).toBeNull();
  });

  it('never writes the draft to browser storage', async () => {
    loadMock.mockResolvedValue({ ok: true, data: record });
    saveMock.mockResolvedValue({ ok: true, data: { ...record, draftRevision: 1 } });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
