/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();
const renameMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: (...args: unknown[]) => renameMock(...args),
  deletePresentationVersion: (...args: unknown[]) => deleteMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

function versionSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefrontId: 'store-1',
    name: 'Current design',
    state: 'draft',
    schemaVersion: 1,
    revision: 0,
    scheduledFor: null,
    lastPublishedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function versionDetail(overrides: Record<string, unknown> = {}) {
  const { config, ...rest } = overrides;
  return { ...versionSummary(rest), config: config ?? DEFAULT_PRESENTATION_CONFIG };
}

describe('ExperienceBuilder persistence wiring — CUST-H1-2 version APIs', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    listMock.mockReset();
    showMock.mockReset();
    createMock.mockReset();
    saveMock.mockReset();
    renameMock.mockReset();
    deleteMock.mockReset();
  });

  it('loads the selected storefront design version on mount', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary()] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail() });
    render(
      <ExperienceBuilder
        storefrontId="store-1"
        initialLocale="en"
        liveStoreName="Al-Noor Store"
      />,
    );
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('store-1'));
    await waitFor(() => expect(showMock).toHaveBeenCalledWith('store-1', 'v1'));
    expect(screen.getByText('Store Experience Builder')).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('opens the exact version named by the versionId prop directly, bypassing the ambiguous-choice auto-select', async () => {
    // A consumer outside this Horizon (the Theme Gallery) passes `versionId`
    // after creating a draft, so it can be opened directly — even when the
    // list has multiple eligible drafts, which would otherwise leave the
    // choice ambiguous (§13).
    listMock.mockResolvedValue({
      ok: true,
      data: [versionSummary({ id: 'version-1', name: 'Theme draft', revision: 3 }), versionSummary({ id: 'version-2', name: 'Other draft' })],
    });
    showMock.mockResolvedValue({
      ok: true,
      data: versionDetail({ id: 'version-1', name: 'Theme draft', schemaVersion: 2, revision: 3 }),
    });
    saveMock.mockResolvedValue({
      ok: true,
      data: versionDetail({ id: 'version-1', name: 'Theme draft', schemaVersion: 2, revision: 4 }),
    });

    const user = userEvent.setup();
    render(
      <ExperienceBuilder
        storefrontId="store-1"
        versionId="version-1"
        initialLocale="en"
      />,
    );

    await waitFor(() => expect(showMock).toHaveBeenCalledWith('store-1', 'version-1'));
    expect(
      document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-version-id'),
    ).toBe('version-1');
    // CUST-H1-3 replaced the CUST-H1-2 hard publish gate with real per-Version
    // eligibility: an opened, unmodified Draft is now publishable.
    expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith(
      'store-1',
      'version-1',
      expect.any(Object),
      3,
    ));
  });

  it('follows the AWJ locale without a redundant language switcher', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary()] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail() });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);

    await waitFor(() => expect(showMock).toHaveBeenCalled());

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

  it('does not claim save success until the exact-version PUT returns 200', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 0 }) });
    saveMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 1 }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][0]).toBe('store-1');
    expect(saveMock.mock.calls[0][1]).toBe('v1');
    expect(saveMock.mock.calls[0][3]).toBe(0);
    expect(screen.getByRole('status').textContent).toMatch(/Version saved/);
    expect(screen.queryByText(/nothing was stored/i)).toBeNull();
  });

  it('preserves SBC internal whitespace while editing and outer-trims at save', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 0 }) });
    saveMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 1 }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    const input = screen.getAllByRole('textbox')[0];
    await user.type(input, ' 00123 456 ');

    expect((input as HTMLInputElement).value).toBe(' 00123 456 ');
    const sealTokenInput = screen.getAllByRole('textbox')[1];
    await user.type(sealTokenInput, ' token=Opaque+/ ');
    expect((sealTokenInput as HTMLInputElement).value).toBe(' token=Opaque+/ ');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][2].sbc.authentication_number).toBe('00123 456');
    expect(saveMock.mock.calls[0][2].sbc.seal_token).toBe('token=Opaque+/');
  });

  it('does not discard an edit made while an earlier save is still in flight (codex round 3)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 0 }) });
    let resolveSave: (value: unknown) => void = () => {};
    saveMock.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    const input = screen.getAllByRole('textbox')[0];
    await user.type(input, 'first edit');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0][2].sbc.authentication_number).toBe('first edit');

    // The merchant keeps editing while that PUT is still pending — nothing in
    // the UI blocks it.
    await user.type(input, ' second edit');
    expect((input as HTMLInputElement).value).toBe('first edit second edit');

    // The save resolves, echoing back exactly the older snapshot it was sent —
    // it must not overwrite the newer edit made in the meantime.
    resolveSave({
      ok: true,
      data: versionDetail({
        revision: 1,
        config: {
          ...DEFAULT_PRESENTATION_CONFIG,
          sbc: { ...DEFAULT_PRESENTATION_CONFIG.sbc, authentication_number: 'first edit' },
        },
      }),
    });
    await waitFor(() => expect(screen.getByText('Version saved.')).toBeTruthy());

    expect((input as HTMLInputElement).value).toBe('first edit second edit');
  });

  it('shows a stale-revision conflict banner and reloads only on explicit request — never merges or claims success', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ revision: 1 })] });
    showMock
      .mockResolvedValueOnce({ ok: true, data: versionDetail({ revision: 1 }) })
      .mockResolvedValueOnce({
        ok: true,
        data: versionDetail({
          revision: 2,
          config: {
            ...DEFAULT_PRESENTATION_CONFIG,
            homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, heroHeadline: 'server' },
          },
        }),
      });
    saveMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(screen.getByRole('alert').textContent).toMatch(/edited from another session/i);
    expect(screen.queryByText(/Version saved/)).toBeNull();
    expect(showMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Reload version' }));
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not write the draft to browser storage', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 0 }) });
    saveMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 1 }) });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
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
    expect(document.querySelector("[data-identity-icon='cr']")).not.toBeNull();
    expect(document.querySelector("[data-identity-icon='vat']")).toBeNull();
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

    expect(screen.getByTestId('sbc-seal-preview').textContent).toBe(
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
    expect(screen.getByText('Al-Noor Company')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('link', { name: 'Manage company information' }).getAttribute('href'),
    ).toBe('/settings');
    expect(screen.queryByDisplayValue('legacy-cr-must-not-edit')).toBeNull();
  });
});
