/**
 * @vitest-environment jsdom
 *
 * CUST-HV V1A / DEF-11 — toolbar primary-action reachability.
 *
 * jsdom has no layout, so the six-width geometry guarantee lives in
 * `e2e/cust-hv-v1a-toolbar-reachability.spec.ts`. This file proves the other
 * half: the structure that makes the geometry possible and honest.
 *
 *  - Exit / Save draft / Publish are plain toolbar buttons, never inside the
 *    «More» menu, so no breakpoint can collapse them.
 *  - Everything that does collapse is reachable from «More» with the SAME
 *    eligibility and the SAME explanation as its inline twin.
 *  - Draft state stays perceivable when the status chip is not on screen.
 *  - «More» is keyboard-operable and returns focus on Escape.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const saveMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
  publishPresentationVersion: vi.fn(),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefrontId: 'store-1',
    name: 'رمضان 1448',
    state: 'draft',
    schemaVersion: 2,
    revision: 1,
    scheduledFor: null,
    lastPublishedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    publishedRevision: null,
    scheduleToken: 'opaque-token-0',
    schedulingRuntimeActive: true,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  const { config, ...rest } = overrides;
  return { ...summary(rest), config: config ?? DEFAULT_PRESENTATION_CONFIG };
}

async function mountBuilder(
  locale: 'ar' | 'en' = 'ar',
  version: Record<string, unknown> = {},
  storefrontUrl: string | null = 'https://a.example.test/',
) {
  listMock.mockResolvedValue({ ok: true, data: [summary(version)] });
  showMock.mockResolvedValue({ ok: true, data: detail(version) });
  const user = userEvent.setup();
  render(
    <ExperienceBuilder
      storefrontId="store-1"
      initialLocale={locale}
      liveStoreName="متجر النور"
      storefrontUrl={storefrontUrl}
    />,
  );
  await waitFor(() => expect(showMock).toHaveBeenCalled());
  return user;
}

const toolbar = () => document.querySelector('[data-builder-toolbar]') as HTMLElement;

describe('ExperienceBuilder — CUST-HV V1A toolbar', () => {
  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    saveMock.mockReset();
  });

  it('keeps Exit, Save draft and Publish directly in the toolbar — never inside the More menu', async () => {
    await mountBuilder('en');

    const bar = within(toolbar());
    const more = bar.getByRole('button', { name: 'More actions' });
    const menu = toolbar().querySelector('[role="menu"]') as HTMLElement;

    for (const selector of ['[data-builder-exit]', '[data-save]', '[data-publish]']) {
      const control = toolbar().querySelector(selector) as HTMLElement;
      expect(control, selector).toBeTruthy();
      expect(menu.contains(control), `${selector} must not live in the menu`).toBe(false);
      expect(more.contains(control)).toBe(false);
    }
    // And the menu offers no duplicate of the three primaries.
    expect(within(menu).queryByText('Save draft')).toBeNull();
    expect(within(menu).queryByText('Publish')).toBeNull();
    expect(within(menu).queryByText('Exit to Commerce')).toBeNull();
  });

  it('exposes every collapsible action from the More menu (Open store, Preview device, Schedule, Restore)', async () => {
    const user = await mountBuilder('en');

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });

    expect(within(menu).getByRole('menuitem', { name: /Open store/ })).toHaveProperty(
      'href',
      'https://a.example.test/',
    );
    const devices = within(menu).getByRole('group', { name: 'Preview device' });
    expect(within(devices).getAllByRole('menuitemradio').map((el) => el.textContent)).toEqual([
      'Desktop',
      'Tablet',
      'Mobile',
    ]);
    expect(within(menu).getByRole('menuitem', { name: 'Schedule' })).toHaveProperty('disabled', false);
    expect(within(menu).getByRole('menuitem', { name: 'Restore default' })).toHaveProperty('disabled', false);
  });

  it('applies the same eligibility and explanation to the More-menu Schedule as to the inline one', async () => {
    const user = await mountBuilder('en', { state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' });

    const inline = toolbar().querySelector('[data-schedule]') as HTMLButtonElement;
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const inMenu = within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', {
      name: 'Schedule',
    }) as HTMLButtonElement;

    expect(inline.disabled).toBe(true);
    expect(inMenu.disabled).toBe(true);
    expect(inMenu.title).toBe(inline.title);
    expect(inMenu.title).not.toBe('');
  });

  it('opens the Schedule dialog from the More menu when the Version is eligible', async () => {
    const user = await mountBuilder('en');

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(
      within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Schedule' }),
    );

    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('switches the preview device from the More menu and marks the active choice', async () => {
    const user = await mountBuilder('en');
    const root = document.querySelector('[data-experience-builder]') as HTMLElement;
    expect(root.getAttribute('data-device')).toBe('desktop');

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Tablet' }));

    expect(root.getAttribute('data-device')).toBe('tablet');
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitemradio', { name: 'Tablet' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Desktop' }).getAttribute('aria-checked')).toBe('false');
  });

  it('omits the Open store entry entirely when no safe storefront URL exists', async () => {
    const user = await mountBuilder('en', {}, null);

    await user.click(screen.getByRole('button', { name: 'More actions' }));

    expect(within(screen.getByRole('menu', { name: 'More actions' })).queryByText(/Open store/)).toBeNull();
    expect(toolbar().querySelector('[data-open-store]')).toBeNull();
  });

  async function makeDirty(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل غير محفوظ');
  }

  it('keeps unsaved state perceivable without the status chip: the trigger name, a dot and the menu header carry it', async () => {
    const user = await mountBuilder('ar');

    // Clean: plain label, no dot.
    expect(screen.getByRole('button', { name: 'المزيد من الإجراءات' })).toBeTruthy();
    expect(toolbar().querySelector('[data-builder-more-dot]')).toBeNull();

    await makeDirty(user);

    const trigger = screen.getByRole('button', { name: 'المزيد من الإجراءات — مسودة غير محفوظة' });
    expect(toolbar().querySelector('[data-builder-more-dot="dirty"]')).toBeTruthy();
    await user.click(trigger);
    expect(toolbar().querySelector('[data-builder-more-status="dirty"]')?.textContent).toBe('مسودة غير محفوظة');
  });

  it('surfaces a version conflict on the More trigger too, in the conflict colour', async () => {
    const user = await mountBuilder('ar');
    saveMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });

    await makeDirty(user);
    await user.click(screen.getByRole('button', { name: 'حفظ المسودة' }));

    await waitFor(() => expect(document.querySelector('[data-version-conflict]')).toBeTruthy());
    expect(toolbar().querySelector('[data-builder-more-dot="conflict"]')).toBeTruthy();
    // The primaries stay on the bar in this state — Save is simply disabled with its reason.
    const save = toolbar().querySelector('[data-save]') as HTMLButtonElement;
    const publish = toolbar().querySelector('[data-publish]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(publish.disabled).toBe(true);
    expect(toolbar().querySelector('[data-builder-exit]')).toBeTruthy();
  });

  it('is operable from the keyboard: Enter opens, Tab reaches the items, Escape closes and returns focus', async () => {
    const user = await mountBuilder('en');
    const trigger = screen.getByRole('button', { name: 'More actions' });

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.tab();
    const active = document.activeElement as HTMLElement;
    expect(active.getAttribute('role')).toMatch(/^menuitem/);

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps menu items out of the tab order while the menu is closed', async () => {
    await mountBuilder('en');

    const menu = toolbar().querySelector('[role="menu"]') as HTMLElement;
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    for (const item of menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')) {
      expect(item.tabIndex).toBe(-1);
    }
  });
});
