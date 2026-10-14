// @vitest-environment jsdom
/**
 * AWJ-STORE-CTX-1 — انحدار سياق المتجر النشط.
 *
 * البلاغ: اختيار «زهور طيبة» ثم فتح «معرض الثيمات» أو «بناء تجربة المتجر» يقلب المتجر النشط إلى «زهور الرشد».
 * السبب: الاختيار كان حالة ذاكرة فقط، وأي تحميل كامل للمستند يسقط إلى `stores[0]`، والخادم يرتّب القائمة بالاسم
 * («الرشد» قبل «طيبة»). كل اختبار هنا كان سيفشل على السلوك القديم ما لم يُذكر خلاف ذلك.
 */
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

const nav = vi.hoisted(() => ({ pathname: '/commerce' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'admin', permissions: ['commerce.manage'] }) }));
vi.mock('@/lib/permissions', () => ({ hasPermission: () => true }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'زهور', logo: null }) }));
vi.mock('@/components/layout/company-logo-mark', () => ({ CompanyLogoMark: () => <span>logo</span> }));
vi.mock('@/components/layout/lang-toggle', () => ({ LangToggle: () => null }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }));

const listVersionsMock = vi.fn();
vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listVersionsMock(...args),
}));

// البنّاء نفسه مغطّى في اختباراته؛ هنا يهمّ فقط أيّ متجر/نسخة تُسلَّم له.
const builderProps = vi.fn();
vi.mock('@/modules/store-experience-builder/ExperienceBuilder', () => ({
  ExperienceBuilder: (props: { storefrontId: string | null; versionId: string | null; previewThemeId: string | null }) => {
    builderProps(props);
    return <div data-testid="builder" data-store={props.storefrontId ?? ''} data-version={props.versionId ?? ''} />;
  },
}));

import { CommerceWorkspaceShell } from '@/components/commerce-workspace/commerce-workspace-shell';
import CommerceAppearancePage from '@/app/(commerce)/commerce/appearance/page';
import CommerceThemesPage from '@/app/(commerce)/commerce/themes/page';
import {
  ACTIVE_STORE_SESSION_KEY,
  readStoreParam,
  resolveActiveStore,
  withStoreParam,
} from './active-store';
import { CommerceStoreProvider, useCommerceStoreContext } from './store-context';
import { COMMERCE_WORKSPACE_MESSAGES } from './messages';
import { StoreSelectionScreen } from './store-selection-screen';
import userEvent from '@testing-library/user-event';
import type { CommerceStoreCatalog } from './stores';

const RASHD = '11111111-1111-4111-8111-111111111111';
const TAIBA = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '99999999-9999-4999-8999-999999999999';

// بالترتيب الذي يعيده الخادم (`orderBy('name')`): «الرشد» أولاً — هذا ما كان يجعله الافتراضي الصامت.
const storesPayload = {
  data: {
    stores: [
      { id: RASHD, name: 'زهور الرشد', sales_channel_id: 'c-r', is_active: true, preview_url: 'https://rashd.example/' },
      { id: TAIBA, name: 'زهور طيبة', sales_channel_id: 'c-t', is_active: true, preview_url: 'https://taiba.example/' },
    ],
  },
};

function navigateTo(path: string) {
  // ما يفعله موجّه Next.js في التنقّل الداخلي: يتغيّر الرابط والمسار دون إعادة تركيب المزوّد.
  window.history.pushState(null, '', path);
  nav.pathname = path.split('?')[0];
}

function hardLoad(path: string) {
  // تحميل كامل للمستند في التبويب نفسه: الرابط يتغيّر، `sessionStorage` يبقى، والمزوّد يُركَّب من جديد.
  cleanup();
  window.history.replaceState(null, '', path);
  nav.pathname = path.split('?')[0];
}

function Probe({ label = 'active' }: { label?: string }) {
  const { selectedStoreId, storeContextStatus, setSelectedStoreId } = useCommerceStoreContext();
  return (
    <div>
      <p data-testid={label}>{selectedStoreId ?? ''}</p>
      <p data-testid={`${label}-status`}>{storeContextStatus}</p>
      <button type="button" onClick={() => setSelectedStoreId(TAIBA)}>{`${label}-taiba`}</button>
      <button type="button" onClick={() => setSelectedStoreId(RASHD)}>{`${label}-rashd`}</button>
    </div>
  );
}

function renderWorkspace(page: React.ReactNode = null) {
  return render(
    <CommerceStoreProvider>
      <Probe />
      {page}
    </CommerceStoreProvider>,
  );
}

/** الاختيار الصريح من شاشة اختيار المتجر: زرّ راديو ثم «اختيار المتجر». */
function chooseStore(name: string) {
  const selection = document.querySelector('[data-store-selection-screen]') as HTMLElement;
  fireEvent.click(within(selection).getByRole('radio', { name }));
  fireEvent.click(within(selection).getByRole('button', { name: 'اختيار المتجر' }));
}

async function needsSelection(label = 'active') {
  // AWJ-STORE-CTX-2: متجران ولا سياق في التبويب ⇒ لا متجر افتراضي.
  await waitFor(() => expect(screen.getByTestId(`${label}-status`).textContent).toBe('needs_selection'));
  expect(screen.getByTestId(label).textContent).toBe('');
}

async function activeIs(id: string) {
  await waitFor(() => expect(screen.getByTestId('active').textContent).toBe(id));
}

beforeEach(() => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/commerce/workspace/storefronts') return storesPayload;
    if (path === '/applications/nav-state') return { data: {} };
    throw new Error(`unexpected ${path}`);
  });
  listVersionsMock.mockImplementation(async (storeId: string) => ({
    ok: true,
    data: [{ id: `published-of-${storeId}`, state: 'published', updatedAt: '2026-10-01T00:00:00Z' }],
  }));
  window.history.replaceState(null, '', '/commerce');
  nav.pathname = '/commerce';
});

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  listVersionsMock.mockReset();
  builderProps.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('resolveActiveStore', () => {
  const catalog: CommerceStoreCatalog = {
    status: 'ready',
    stores: [
      { id: RASHD, name: 'زهور الرشد', salesChannelId: null, isActive: true, previewUrl: null, defaultLocale: 'ar', businessVertical: 'general', recommendedCapabilities: [] },
      { id: TAIBA, name: 'زهور طيبة', salesChannelId: null, isActive: true, previewUrl: null, defaultLocale: 'ar', businessVertical: 'general', recommendedCapabilities: [] },
    ],
  };

  it('honours an explicit request and never substitutes another store for an unknown one', () => {
    expect(resolveActiveStore(catalog, { id: TAIBA, source: 'url' })).toEqual({ status: 'ready', storeId: TAIBA });
    expect(resolveActiveStore(catalog, { id: TAIBA, source: 'session' })).toEqual({ status: 'ready', storeId: TAIBA });
    expect(resolveActiveStore(catalog, { id: FOREIGN, source: 'url' })).toEqual({ status: 'invalid', storeId: null, requestedId: FOREIGN });
    expect(resolveActiveStore(catalog, { id: FOREIGN, source: 'session' }).storeId).toBeNull();
  });

  it('requires an explicit choice for a multi-store tenant without context, and auto-selects a single store (AWJ-STORE-CTX-2)', () => {
    expect(resolveActiveStore(catalog, null)).toEqual({ status: 'needs_selection', storeId: null });
    expect(resolveActiveStore({ status: 'ready', stores: [catalog.status === 'ready' ? catalog.stores[1] : null!] }, null))
      .toEqual({ status: 'ready', storeId: TAIBA });
    expect(resolveActiveStore({ status: 'loading' }, { id: TAIBA, source: 'url' })).toEqual({ status: 'pending', storeId: null });
    expect(resolveActiveStore({ status: 'empty' }, null).storeId).toBeNull();
  });

  it('builds store-carrying links without dropping other parameters or the hash', () => {
    expect(withStoreParam('/commerce/themes', TAIBA)).toBe(`/commerce/themes?store=${TAIBA}`);
    expect(withStoreParam('/commerce/appearance?version=v1#x', TAIBA)).toBe(`/commerce/appearance?version=v1&store=${TAIBA}#x`);
    expect(withStoreParam('/commerce', null)).toBe('/commerce');
    expect(readStoreParam(`?store=${TAIBA}`)).toBe(TAIBA);
    expect(readStoreParam('?store=../../x')).toBeNull();
  });
});

describe('active store across Commerce navigation (زهور طيبة / زهور الرشد)', () => {
  it('selecting زهور طيبة then opening the Theme Gallery stays on زهور طيبة and reads only its versions', async () => {
    renderWorkspace();
    await needsSelection();
    fireEvent.click(screen.getByText('active-taiba'));
    await activeIs(TAIBA);

    // تنقّل داخلي ثم — الأهم — تحميل كامل (كما يحدث في التحديث أو عند التنقّل الصلب).
    navigateTo('/commerce/themes');
    hardLoad('/commerce/themes');
    renderWorkspace(<CommerceThemesPage />);
    await activeIs(TAIBA);
    await waitFor(() => expect(listVersionsMock).toHaveBeenLastCalledWith(TAIBA));
    expect(listVersionsMock).not.toHaveBeenCalledWith(RASHD, expect.anything());
    await waitFor(() => expect(document.querySelector('[data-theme-preview-link="awj-market"]')).toBeTruthy());
    const href = document.querySelector('[data-theme-preview-link="awj-market"]')?.getAttribute('href') ?? '';
    expect(href).toContain(`store=${TAIBA}`);
    expect(href).toContain(`version=published-of-${TAIBA}`);
    expect(href).not.toContain(RASHD);
  });

  it('selecting زهور طيبة then opening the Store Experience builder hands the builder زهور طيبة', async () => {
    renderWorkspace();
    await needsSelection();
    fireEvent.click(screen.getByText('active-taiba'));
    await activeIs(TAIBA);

    hardLoad('/commerce/appearance');
    renderWorkspace(<CommerceAppearancePage />);
    await waitFor(() => expect(screen.getByTestId('builder').getAttribute('data-store')).toBe(TAIBA));
    // لم يُركَّب البنّاء قطّ على «الرشد» ولا على «لا متجر» قبل الحسم.
    expect(builderProps.mock.calls.every(([props]) => props.storefrontId === TAIBA)).toBe(true);
  });

  it('keeps the store through every Commerce section (client navigation)', async () => {
    const view = renderWorkspace();
    await needsSelection();
    fireEvent.click(screen.getByText('active-taiba'));
    await activeIs(TAIBA);
    for (const path of [
      '/commerce/stores', '/commerce/published-products', '/commerce/themes', '/commerce/appearance',
      '/commerce/merchandising', '/commerce/delivery', '/commerce/gifting', '/commerce/domains', '/commerce/integrations',
      '/commerce/onboarding', '/commerce',
    ]) {
      act(() => navigateTo(path));
      // موجّه Next.js يعيد التصيير عند تغيّر المسار؛ المزوّد نفسه لا يُعاد تركيبه.
      view.rerender(<CommerceStoreProvider><Probe /></CommerceStoreProvider>);
      await activeIs(TAIBA);
      await waitFor(() => expect(readStoreParam(window.location.search)).toBe(TAIBA));
    }
    expect(window.sessionStorage.getItem(ACTIVE_STORE_SESSION_KEY)).toBe(TAIBA);
  });

  it('switches between زهور طيبة and زهور الرشد only on an explicit choice, and each switch is persisted', async () => {
    renderWorkspace();
    await needsSelection();
    fireEvent.click(screen.getByText('active-taiba'));
    await activeIs(TAIBA);
    await waitFor(() => expect(readStoreParam(window.location.search)).toBe(TAIBA));
    fireEvent.click(screen.getByText('active-rashd'));
    await activeIs(RASHD);
    await waitFor(() => expect(readStoreParam(window.location.search)).toBe(RASHD));
    expect(window.sessionStorage.getItem(ACTIVE_STORE_SESSION_KEY)).toBe(RASHD);
    fireEvent.click(screen.getByText('active-taiba'));
    await activeIs(TAIBA);

    hardLoad('/commerce');
    renderWorkspace();
    await activeIs(TAIBA);
  });

  it('survives a page refresh, and a direct link opens exactly the store it names', async () => {
    // تحديث: الرابط يحمل المتجر.
    hardLoad(`/commerce/themes?store=${TAIBA}`);
    renderWorkspace();
    await activeIs(TAIBA);

    // رابط مباشر في تبويب جديد (ذاكرة جلسة فارغة) لبنّاء نسخة بعينها.
    hardLoad(`/commerce/appearance?store=${TAIBA}&version=v-taiba`);
    window.sessionStorage.clear();
    renderWorkspace(<CommerceAppearancePage />);
    await waitFor(() => expect(screen.getByTestId('builder').getAttribute('data-store')).toBe(TAIBA));
    expect(screen.getByTestId('builder').getAttribute('data-version')).toBe('v-taiba');
    // بقية معاملات الرابط تبقى كما هي.
    expect(new URLSearchParams(window.location.search).get('version')).toBe('v-taiba');
  });

  it('two tabs keep independent stores: one tab never pushes its choice into another', async () => {
    const tabs = render(
      <>
        <CommerceStoreProvider><Probe label="tabA" /></CommerceStoreProvider>
        <CommerceStoreProvider><Probe label="tabB" /></CommerceStoreProvider>
      </>,
    );
    await needsSelection('tabA');
    fireEvent.click(screen.getByText('tabA-taiba'));
    await waitFor(() => expect(screen.getByTestId('tabA').textContent).toBe(TAIBA));
    fireEvent.click(screen.getByText('tabB-rashd'));
    await waitFor(() => expect(screen.getByTestId('tabB').textContent).toBe(RASHD));
    expect(screen.getByTestId('tabA').textContent).toBe(TAIBA);

    // ما قد يبثّه تبويب آخر عبر التخزين المشترك لا يُستمَع إليه.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: ACTIVE_STORE_SESSION_KEY, newValue: RASHD }));
    });
    expect(screen.getByTestId('tabA').textContent).toBe(TAIBA);
    // لا شيء من سياق المتجر في التخزين المشترك بين التبويبات.
    expect(Object.keys(window.localStorage).some((key) => key.includes('store'))).toBe(false);
    tabs.unmount();
  });

  it('a link to a store outside this tenant/catalog never opens another store and blocks the builder', async () => {
    hardLoad(`/commerce/appearance?store=${FOREIGN}&version=v-foreign`);
    window.sessionStorage.setItem(ACTIVE_STORE_SESSION_KEY, TAIBA);
    renderWorkspace(<CommerceAppearancePage />);
    await waitFor(() => expect(screen.getByTestId('active-status').textContent).toBe('invalid'));
    expect(screen.getByTestId('active').textContent).toBe('');
    expect(screen.queryByTestId('builder')).toBeNull();
    expect(builderProps).not.toHaveBeenCalled();
    expect(document.querySelector('[data-store-context-invalid]')).toBeTruthy();
    // اختيار صالح سابق في التبويب لا يُمحى بسبب رابط خاطئ.
    expect(window.sessionStorage.getItem(ACTIVE_STORE_SESSION_KEY)).toBe(TAIBA);

    // الخروج باختيار صريح فقط — ونسخة المتجر الأجنبي لا تُفتح تحت المتجر المختار.
    chooseStore('زهور طيبة');
    await waitFor(() => expect(screen.getByTestId('builder').getAttribute('data-store')).toBe(TAIBA));
    expect(screen.getByTestId('builder').getAttribute('data-version')).toBe('');
  });

  it('keeps the previous builder behaviour for a tenant with no store yet (local editing, nothing to save to)', async () => {
    apiMock.mockImplementation(async () => ({ data: { stores: [] } }));
    hardLoad('/commerce/appearance');
    renderWorkspace(<CommerceAppearancePage />);
    await waitFor(() => expect(screen.getByTestId('builder')).toBeTruthy());
    expect(screen.getByTestId('builder').getAttribute('data-store')).toBe('');
    expect(window.location.search).toBe('');
  });

  it('a stale tab session for a store no longer listed is not silently replaced', async () => {
    window.sessionStorage.setItem(ACTIVE_STORE_SESSION_KEY, FOREIGN);
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('active-status').textContent).toBe('invalid'));
    expect(screen.getByTestId('active').textContent).toBe('');
  });

  it('the shell replaces the page with the store chooser when the context is invalid, and its links carry the store', async () => {
    hardLoad(`/commerce/themes?store=${FOREIGN}`);
    render(
      <CommerceStoreProvider>
        <CommerceWorkspaceShell><div data-testid="page-body">page</div></CommerceWorkspaceShell>
      </CommerceStoreProvider>,
    );
    await waitFor(() => expect(document.querySelector('[data-store-context-invalid]')).toBeTruthy());
    expect(screen.queryByTestId('page-body')).toBeNull();

    chooseStore('زهور طيبة');
    await waitFor(() => expect(screen.getByTestId('page-body')).toBeTruthy());
    const themesLinks = Array.from(document.querySelectorAll('a[href^="/commerce/themes"]'));
    expect(themesLinks.length).toBeGreaterThan(0);
    for (const link of themesLinks) expect(link.getAttribute('href')).toBe(`/commerce/themes?store=${TAIBA}`);
  });

  it('a URL naming another store does not switch a mounted context, and its version is not opened (history back/forward)', async () => {
    hardLoad(`/commerce/themes?store=${RASHD}`);
    const view = render(<CommerceStoreProvider><Probe />{null}</CommerceStoreProvider>);
    await activeIs(RASHD);

    // رجوع/تقدّم في السجلّ إلى رابط بنّاء كُتب حين كان «طيبة» نشطاً.
    act(() => navigateTo(`/commerce/appearance?store=${TAIBA}&version=v-taiba`));
    view.rerender(<CommerceStoreProvider><Probe /><CommerceAppearancePage /></CommerceStoreProvider>);
    await waitFor(() => expect(screen.getByTestId('builder').getAttribute('data-store')).toBe(RASHD));
    expect(screen.getByTestId('active').textContent).toBe(RASHD);
    expect(screen.getByTestId('builder').getAttribute('data-version')).toBe('');
    expect(builderProps.mock.calls.some(([props]) => props.versionId === 'v-taiba')).toBe(false);
    await waitFor(() => expect(readStoreParam(window.location.search)).toBe(RASHD));
  });
});

describe('explicit store selection for multi-store tenants (AWJ-STORE-CTX-2)', () => {
  function renderShell(page: React.ReactNode) {
    return render(
      <CommerceStoreProvider>
        <Probe />
        <CommerceWorkspaceShell>{page}</CommerceWorkspaceShell>
      </CommerceStoreProvider>,
    );
  }

  it('opens no store by default: the store-scoped page is replaced by the chooser and nothing is read or persisted', async () => {
    hardLoad('/commerce/themes');
    renderShell(<CommerceThemesPage />);
    await needsSelection();
    expect(document.querySelector('[data-store-selection-required]')).toBeTruthy();
    expect(screen.getByText('اختر المتجر الذي تعمل عليه')).toBeTruthy();
    expect(document.querySelector('[data-theme-card]')).toBeNull();
    expect(listVersionsMock).not.toHaveBeenCalled();
    expect(readStoreParam(window.location.search)).toBeNull();
    expect(window.sessionStorage.getItem(ACTIVE_STORE_SESSION_KEY)).toBeNull();
  });

  it('the explicit choice opens the page on that store and pins it to the tab and URL', async () => {
    hardLoad('/commerce/themes');
    renderShell(<CommerceThemesPage />);
    await needsSelection();
    chooseStore('زهور طيبة');
    await activeIs(TAIBA);
    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledWith(TAIBA));
    expect(listVersionsMock).not.toHaveBeenCalledWith(RASHD);
    await waitFor(() => expect(readStoreParam(window.location.search)).toBe(TAIBA));
    expect(window.sessionStorage.getItem(ACTIVE_STORE_SESSION_KEY)).toBe(TAIBA);

    hardLoad('/commerce/themes');
    renderShell(<CommerceThemesPage />);
    await activeIs(TAIBA);
  });

  it('never mounts the builder before a store is chosen, and never under a default store', async () => {
    hardLoad('/commerce/appearance?version=v-any');
    renderWorkspace(<CommerceAppearancePage />);
    await needsSelection();
    expect(screen.queryByTestId('builder')).toBeNull();
    expect(builderProps).not.toHaveBeenCalled();
    expect(document.querySelector('[data-store-selection-required]')).toBeTruthy();
  });

  it('keeps tenant-wide pages reachable without a chosen store', async () => {
    hardLoad('/commerce/stores');
    renderShell(<div data-testid="stores-page">stores</div>);
    await needsSelection();
    expect(screen.getByTestId('stores-page')).toBeTruthy();
    expect(document.querySelector('[data-store-selection-required]')).toBeNull();
  });

  it('a single-store tenant is still selected automatically (no extra step)', async () => {
    apiMock.mockImplementation(async (path: string) => (
      path === '/commerce/workspace/storefronts' ? { data: { stores: [storesPayload.data.stores[1]] } } : { data: {} }
    ));
    hardLoad('/commerce/themes');
    renderShell(<CommerceThemesPage />);
    await activeIs(TAIBA);
    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledWith(TAIBA));
    expect(document.querySelector('[data-store-selection-required]')).toBeNull();
  });

  it('zero stores: no selection screen — the existing empty/creation experience renders unchanged', async () => {
    apiMock.mockImplementation(async (path: string) => (path === '/commerce/workspace/storefronts' ? { data: { stores: [] } } : { data: {} }));
    hardLoad('/commerce/stores');
    renderShell(<div data-testid="stores-page">create your first store</div>);
    await waitFor(() => expect(screen.getByTestId('stores-page')).toBeTruthy());
    expect(document.querySelector('[data-store-selection-screen]')).toBeNull();
    expect(screen.getByTestId('active').textContent).toBe('');
  });

  it('lists exactly the stores the server returned for this tenant, and requires the explicit action', async () => {
    hardLoad('/commerce/themes');
    renderShell(<CommerceThemesPage />);
    await needsSelection();
    const selection = document.querySelector('[data-store-selection-screen]') as HTMLElement;
    expect(within(selection).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual([RASHD, TAIBA]);
    expect(selection.textContent).not.toContain(FOREIGN);
    const action = within(selection).getByRole('button', { name: 'اختيار المتجر' });
    expect(action.hasAttribute('disabled')).toBe(true);
    // تحديد خيار وحده لا يفتح متجراً.
    fireEvent.click(within(selection).getByRole('radio', { name: 'زهور طيبة' }));
    expect(screen.getByTestId('active-status').textContent).toBe('needs_selection');
    expect(listVersionsMock).not.toHaveBeenCalled();
    fireEvent.click(action);
    await activeIs(TAIBA);
  });

  it('is fully keyboard operable (Tab to the store, Space to pick, Tab + Enter to confirm)', async () => {
    hardLoad('/commerce/themes');
    render(<CommerceStoreProvider><Probe /><StoreSelectionScreen /></CommerceStoreProvider>);
    await needsSelection();
    const user = userEvent.setup();
    await user.tab(); // زرّا Probe أولاً في ترتيب التنقّل
    await user.tab();
    await user.tab();
    expect((document.activeElement as HTMLInputElement).type).toBe('radio');
    await user.keyboard(' ');
    expect((document.activeElement as HTMLInputElement).checked).toBe(true);
    const picked = (document.activeElement as HTMLInputElement).value;
    await user.tab();
    expect(document.activeElement?.textContent).toBe('اختيار المتجر');
    await user.keyboard('{Enter}');
    await activeIs(picked);
  });

  it('handles the catalog loading, error (with retry) and empty states itself', async () => {
    let resolve: (value: unknown) => void = () => {};
    apiMock.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const view = render(<CommerceStoreProvider><StoreSelectionScreen /></CommerceStoreProvider>);
    expect(document.querySelector('[aria-busy="true"], [role="status"]')).toBeTruthy();
    await act(async () => resolve({ data: { stores: [] } }));
    await waitFor(() => expect(screen.getByText(COMMERCE_WORKSPACE_MESSAGES.ar.noStoreYetTitle)).toBeTruthy());
    view.unmount();

    apiMock.mockReset();
    apiMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(storesPayload);
    render(<CommerceStoreProvider><Probe /><StoreSelectionScreen /></CommerceStoreProvider>);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(document.querySelector('[data-store-selection-screen]')).toBeTruthy());
  });

  it('two tabs: choosing in one tab never resolves the other, which still asks for its own choice', async () => {
    render(
      <>
        <CommerceStoreProvider><Probe label="tabA" /></CommerceStoreProvider>
        <CommerceStoreProvider><Probe label="tabB" /></CommerceStoreProvider>
      </>,
    );
    await needsSelection('tabA');
    await needsSelection('tabB');
    fireEvent.click(screen.getByText('tabA-taiba'));
    await waitFor(() => expect(screen.getByTestId('tabA').textContent).toBe(TAIBA));
    expect(screen.getByTestId('tabB-status').textContent).toBe('needs_selection');
    expect(screen.getByTestId('tabB').textContent).toBe('');
  });

  it('after an explicit choice, Theme Gallery → builder stays on that store with its own version only', async () => {
    hardLoad('/commerce/themes');
    renderShell(<CommerceThemesPage />);
    await needsSelection();
    chooseStore('زهور طيبة');
    await waitFor(() => expect(document.querySelector('[data-theme-preview-link="awj-market"]')).toBeTruthy());
    const href = document.querySelector('[data-theme-preview-link="awj-market"]')!.getAttribute('href')!;
    expect(href).toContain(`store=${TAIBA}`);
    expect(href).toContain(`version=published-of-${TAIBA}`);

    // فتح رابط المعاينة (تحميل كامل) في التبويب نفسه.
    hardLoad(href);
    renderWorkspace(<CommerceAppearancePage />);
    await waitFor(() => expect(screen.getByTestId('builder').getAttribute('data-store')).toBe(TAIBA));
    expect(screen.getByTestId('builder').getAttribute('data-version')).toBe(`published-of-${TAIBA}`);
    expect(builderProps.mock.calls.every(([props]) => props.storefrontId === TAIBA)).toBe(true);
  });
});
