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
    window.localStorage.clear();
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

  it('follows the AWJ locale without a redundant language switcher', async () => {
    loadMock.mockResolvedValue({ ok: true, data: record });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);

    await waitFor(() => expect(loadMock).toHaveBeenCalledWith('store-1'));

    const builder = document.querySelector('[data-experience-builder]');
    expect(builder?.getAttribute('dir')).toBe('ltr');
    expect(screen.queryByText('ع', { selector: 'button' })).toBeNull();
    expect(screen.queryByText('EN', { selector: 'button' })).toBeNull();
  });

  it('keeps the preview canvas independently scrollable', () => {
    render(<ExperienceBuilder initialLocale="ar" />);

    const preview = document.querySelector('[data-builder-preview]');
    const scrollRegion = preview?.querySelector('[data-customizer-scroll]');

    expect(scrollRegion?.className).toContain('overflow-y-auto');
    expect(scrollRegion?.className).toContain('md:overflow-y-scroll');
    expect(scrollRegion?.className).toContain('overscroll-contain');
  });

  it('defaults to an expanded builder navigation and reclaims its width when collapsed', async () => {
    const user = userEvent.setup();
    render(<ExperienceBuilder initialLocale="en" />);

    const builder = document.querySelector('[data-experience-builder]');
    const navigation = screen.getByRole('navigation', { name: 'Customization controls' });
    expect(builder?.getAttribute('data-builder-navigation-collapsed')).toBe('false');
    expect(navigation.className).toContain('w-[196px]');
    expect(
      screen
        .getByRole('button', { name: 'Collapse Store Builder navigation' })
        .getAttribute('aria-expanded'),
    ).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Collapse Store Builder navigation' }));

    expect(builder?.getAttribute('data-builder-navigation-collapsed')).toBe('true');
    expect(navigation.className).toContain('lg:w-16');
    expect(navigation.className).not.toContain('w-[196px]');
    expect(
      screen
        .getByRole('button', { name: 'Expand Store Builder navigation' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('restores only valid persisted collapsed state and can expand again', async () => {
    window.localStorage.setItem('awj-store-builder-sidebar-collapsed', 'true');
    const user = userEvent.setup();
    const { unmount } = render(<ExperienceBuilder initialLocale="en" />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expand Store Builder navigation' })).toBeTruthy(),
    );
    const homepage = screen.getByRole('button', { name: 'Homepage' });
    expect(homepage.getAttribute('title')).toBe('Homepage');
    expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('title')).toBe(
      'Appearance',
    );

    await user.click(screen.getByRole('button', { name: 'Expand Store Builder navigation' }));
    expect(
      screen
        .getByRole('button', { name: 'Collapse Store Builder navigation' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(window.localStorage.getItem('awj-store-builder-sidebar-collapsed')).toBe('false');
    unmount();

    window.localStorage.setItem('awj-store-builder-sidebar-collapsed', 'unexpected');
    render(<ExperienceBuilder initialLocale="en" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Collapse Store Builder navigation' })).toBeTruthy(),
    );
  });

  it('keeps mobile navigation independent from the desktop collapsed preference', async () => {
    window.localStorage.setItem('awj-store-builder-sidebar-collapsed', 'true');
    render(<ExperienceBuilder initialLocale="en" />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expand Store Builder navigation' })).toBeTruthy(),
    );
    const navigation = screen.getByRole('navigation', { name: 'Customization controls' });
    expect(navigation.className).toContain('hidden lg:flex');
    expect(document.querySelector('[data-builder-controls]')?.className).toContain('md:flex');
    expect(document.querySelector('[data-builder-preview]')).toBeTruthy();
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

  it('preserves SBC internal whitespace while editing and outer-trims at save', async () => {
    loadMock.mockResolvedValue({ ok: true, data: record });
    saveMock.mockResolvedValue({
      ok: true,
      data: { ...record, draftRevision: 1 },
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    const input = screen.getAllByRole('textbox')[0];
    await user.type(input, ' 00123 456 ');

    expect((input as HTMLInputElement).value).toBe(' 00123 456 ');
    const sealTokenInput = screen.getAllByRole('textbox')[1];
    await user.type(sealTokenInput, ' token=Opaque+/ ');
    expect((sealTokenInput as HTMLInputElement).value).toBe(' token=Opaque+/ ');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][1].sbc.authentication_number).toBe('00123 456');
    expect(saveMock.mock.calls[0][1].sbc.seal_token).toBe('token=Opaque+/');
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

  it('does not write the draft to browser storage', async () => {
    loadMock.mockResolvedValue({ ok: true, data: record });
    saveMock.mockResolvedValue({ ok: true, data: { ...record, draftRevision: 1 } });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(
      setItem.mock.calls.some(([key]) => key === 'awj-store-builder-draft'),
    ).toBe(false);
    setItem.mockRestore();
  });

  it('renders canonical CR and SBC presentation without legacy CR', () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      verification: {
        ...DEFAULT_PRESENTATION_CONFIG.verification,
        crNumber: 'legacy-cr-must-not-render',
      },
      sbc: {
        ...DEFAULT_PRESENTATION_CONFIG.sbc,
        show_in_storefront: true,
      },
    };

    render(
      <ExperienceBuilder
        initialConfig={config}
        initialLocale="en"
        businessIdentity={{
          legal_name: 'Al-Noor Company',
          cr_number: '7050247977',
          vat_number: null,
        }}
      />,
    );

    expect(screen.getByText('Commercial registration: 7050247977')).toBeTruthy();
    expect(screen.queryByText(/legacy-cr-must-not-render/)).toBeNull();
    expect(screen.getByText('Verified in Saudi Business Center')).toBeTruthy();
  });

  it('keeps the official seal out of the authenticated customizer preview', () => {
    render(
      <ExperienceBuilder
        initialConfig={{
          ...DEFAULT_PRESENTATION_CONFIG,
          sbc: {
            ...DEFAULT_PRESENTATION_CONFIG.sbc,
            seal_token: 'opaque-token-must-not-reach-the-admin-dom',
            show_in_storefront: true,
          },
        }}
        initialLocale="en"
      />,
    );

    expect(screen.getByTestId('sbc-seal-preview')).toHaveTextContent(
      'Editor preview: the official Saudi Business Center seal will appear on the published storefront.',
    );
    expect(screen.queryByTestId('sbc-official-seal')).toBeNull();
    expect(screen.queryByText('opaque-token-must-not-reach-the-admin-dom')).toBeNull();
    expect(
      document.querySelector(
        'script[src="https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js"]',
      ),
    ).toBeNull();
  });

  it('renders no CR row when canonical CR is empty', () => {
    render(
      <ExperienceBuilder
        initialLocale="en"
        businessIdentity={{ legal_name: null, cr_number: '   ', vat_number: null }}
      />,
    );

    expect(screen.queryByText(/Commercial registration/)).toBeNull();
  });

  it('does not expose the legacy CR value as an editable control', async () => {
    const user = userEvent.setup();
    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={{
          ...DEFAULT_PRESENTATION_CONFIG,
          verification: {
            ...DEFAULT_PRESENTATION_CONFIG.verification,
            crNumber: 'legacy-cr-must-not-edit',
          },
        }}
        businessIdentity={{
          legal_name: 'Al-Noor Company',
          cr_number: '7050247977',
          vat_number: null,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));

    expect(screen.getByText('7050247977')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Manage company information' }).getAttribute('href'),
    ).toBe('/settings');
    expect(screen.queryByDisplayValue('legacy-cr-must-not-edit')).toBeNull();
  });
});
