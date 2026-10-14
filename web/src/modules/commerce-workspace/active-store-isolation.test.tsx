// @vitest-environment jsdom
/**
 * AWJ-STORE-CTX-1 — انحدار سياق المتجر النشط.
 *
 * البلاغ: اختيار «زهور طيبة» ثم فتح «معرض الثيمات» أو «بناء تجربة المتجر» يقلب المتجر النشط إلى «زهور الرشد».
 * السبب: الاختيار كان حالة ذاكرة فقط، وأي تحميل كامل للمستند يسقط إلى `stores[0]`، والخادم يرتّب القائمة بالاسم
 * («الرشد» قبل «طيبة»). كل اختبار هنا كان سيفشل على السلوك القديم ما لم يُذكر خلاف ذلك.
 */
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('keeps the legacy first-store default only when the tab has no store context at all', () => {
    expect(resolveActiveStore(catalog, null)).toEqual({ status: 'ready', storeId: RASHD });
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
    await activeIs(RASHD);
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
    await activeIs(RASHD);
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
    await activeIs(RASHD);
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
    await activeIs(RASHD);
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
    await waitFor(() => expect(screen.getByTestId('tabA').textContent).toBe(RASHD));
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
    fireEvent.change(screen.getByRole('combobox', { name: 'اختر متجراً' }), { target: { value: TAIBA } });
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

    fireEvent.change(screen.getAllByRole('combobox', { name: 'اختر متجراً' })[0], { target: { value: TAIBA } });
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
