// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';

const state = vi.hoisted(() => ({
  pathname: '/fuel-stations/ops',
  push: vi.fn(),
  user: { id: 'u1', tenant_id: 't1', name: 'Sami', email: 's@x.test', role: 'cashier' } as Record<string, unknown>,
  granted: ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'] as string[],
}));

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ push: state.push, replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('../context', () => ({
  useStationOps: () => ({ viewer: state.user, can: (permission: string) => state.granted.includes(permission) || state.granted.includes('*') }),
}));

import { GuideProvider, useSmartGuide } from './guide-context';
import { GuideScreenShortcut, GuideToursPanel } from './tours-panel';
import { progressKey, readProgress } from './progress';

const M = TEST_MESSAGES.en.stationOps;
const tour = M.guide.tour;

/** jsdom لا يحسب التخطيط: كل عنصر «ظاهر» ما لم يُعلَّم `data-test-hidden`، وله مستطيل ثابت. */
beforeEach(() => {
  state.pathname = '/fuel-stations/ops';
  state.push.mockReset();
  state.granted = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'];
  state.user = { id: 'u1', tenant_id: 't1', name: 'Sami', email: 's@x.test', role: 'cashier' };
  window.localStorage.clear();
  window.localStorage.setItem('awj.station-guide.force', '1');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[data-test-hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top: 100, left: 20, width: 200, height: 60, right: 220, bottom: 160, x: 20, y: 100, toJSON: () => ({}) }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

/** شاشة رئيسية مبسّطة بالمرساة نفسها التي تعتمدها الجولة. */
function Home({ withHelp = true, nextStepHidden = false, onPrimary = vi.fn() }: { withHelp?: boolean; nextStepHidden?: boolean; onPrimary?: () => void }) {
  return (
    <div>
      <div id="fo-station">Harbor</div>
      <section data-next-step="open_shift" {...(nextStepHidden ? { 'data-test-hidden': '' } : {})}>next</section>
      <button type="button" data-primary-action="" onClick={onPrimary}>Open shift</button>
      <section aria-labelledby="fo-products-h"><h2 id="fo-products-h">Products</h2></section>
      <nav aria-label="Main">nav</nav>
      {withHelp ? <button type="button" data-guide="help-button">?</button> : null}
    </div>
  );
}

const card = () => screen.getByRole('dialog');
const next = () => fireEvent.click(within(card()).getByRole('button', { name: M.guide.ui.next }));
async function waitForGuide() { return screen.findByRole('dialog', undefined, { timeout: 5000 }); }

describe('AWJ Smart Guide — welcome tour', () => {
  it('starts by itself for a new user, in the real language, with a progress bar and the first card centred', async () => {
    renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await waitForGuide();
    expect(within(card()).getByText(tour.welcome.intro.title)).toBeTruthy();
    expect(within(card()).getByText('Step 1 of 8')).toBeTruthy();
    expect(within(card()).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(card().getAttribute('aria-modal')).toBe('false'); // لا تحبس التركيز ولا تعطّل الصفحة
    expect(document.querySelector('[data-guide-dim]')).not.toBeNull();
  }, 15000);

  it.each(['ar', 'en'] as const)('shows Arabic and English copy with the matching direction (%s)', async (locale) => {
    renderIntl(<GuideProvider><Home /></GuideProvider>, locale);
    await waitForGuide();
    expect(within(card()).getByText(TEST_MESSAGES[locale].stationOps.guide.tour.welcome.intro.title)).toBeTruthy();
    expect(within(card()).getByRole('button', { name: TEST_MESSAGES[locale].stationOps.guide.ui.skip })).toBeTruthy();
  }, 15000);

  it('does not start automatically under automated runs unless forced, nor twice for the same user', async () => {
    window.localStorage.removeItem('awj.station-guide.force');
    renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('walks forward and back with Next/Back, highlights the REAL element, and saves progress every step', async () => {
    renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await waitForGuide();
    next();
    await waitFor(() => expect(within(card()).getByText(tour.welcome.station.title)).toBeTruthy());
    expect(document.querySelector('[data-guide-spotlight]')).not.toBeNull();
    expect(screen.getByRole('button', { name: M.guide.ui.previous })).toBeTruthy();
    const saved = () => readProgress(progressKey('t1', 'u1')).welcome;
    expect(saved()).toMatchObject({ status: 'in_progress', step: 1 });
    fireEvent.click(screen.getByRole('button', { name: M.guide.ui.previous }));
    await waitFor(() => expect(within(card()).getByText(tour.welcome.intro.title)).toBeTruthy());
    expect(saved()?.step).toBe(0);
  }, 15000);

  it('finishing marks it completed; skipping marks it skipped; neither returns on its own', async () => {
    const view = renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await waitForGuide();
    for (let i = 0; i < 7; i += 1) { next(); await waitFor(() => expect(within(card()).getByText(`Step ${i + 2} of 8`)).toBeTruthy()); }
    fireEvent.click(within(card()).getByRole('button', { name: M.guide.ui.done }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readProgress(progressKey('t1', 'u1')).welcome?.status).toBe('completed');
    view.unmount();

    renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(screen.queryByRole('dialog')).toBeNull();
  }, 25000);

  it('Escape skips the tour and remembers it', async () => {
    renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await waitForGuide();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readProgress(progressKey('t1', 'u1')).welcome?.status).toBe('skipped');
  }, 15000);

  it('skips steps whose element is missing or hidden instead of explaining nothing', async () => {
    renderIntl(<GuideProvider><Home withHelp={false} nextStepHidden /></GuideProvider>, 'en');
    await waitForGuide();
    // 8 خطوات − (خطوة التالية مخفية) − (المساعدة غير موجودة) = 6.
    expect(within(card()).getByText('Step 1 of 6')).toBeTruthy();
    const titles: string[] = [];
    for (let i = 0; i < 5; i += 1) { next(); await waitFor(() => expect(within(card()).getByText(`Step ${i + 2} of 6`)).toBeTruthy()); titles.push(card().querySelector('h2')!.textContent!); }
    expect(titles).not.toContain(tour.welcome.nextStep.title);
    expect(titles).not.toContain(tour.welcome.help.title);
  }, 25000);

  it('never presses the highlighted button or sends anything for the user, and the real button stays clickable', async () => {
    const onPrimary = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderIntl(<GuideProvider><Home onPrimary={onPrimary} /></GuideProvider>, 'en');
    await waitForGuide();
    for (let i = 0; i < 7; i += 1) { next(); await waitFor(() => expect(within(card()).getByText(`Step ${i + 2} of 8`)).toBeTruthy()); }
    expect(onPrimary).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // التعتيم والـSpotlight لا يلتقطان اللمس (pointer-events: none على الغلاف)، والبطاقة وحدها تلتقطه.
    expect(document.querySelector('[data-smart-guide]')!.className).toContain('pointer-events-none');
    expect(card().className).toContain('pointer-events-auto');
    fireEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  }, 25000);

  it('absorbs a quick second tap right after each step and after the tour closes (ghost-tap guard), then lets everything through', async () => {
    renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await waitForGuide();
    expect(document.querySelector('[data-guide-shield]')).not.toBeNull(); // عند ظهور الجولة
    await waitFor(() => expect(document.querySelector('[data-guide-shield]')).toBeNull(), { timeout: 2000 });
    next();
    await waitFor(() => expect(within(card()).getByText('Step 2 of 8')).toBeTruthy());
    expect(document.querySelector('[data-guide-shield]')).not.toBeNull(); // بعد تغيّر الخطوة
    await waitFor(() => expect(document.querySelector('[data-guide-shield]')).toBeNull(), { timeout: 2000 });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-guide-shield]')).not.toBeNull(); // بعد الإغلاق
    await waitFor(() => expect(document.querySelector('[data-guide-shield]')).toBeNull(), { timeout: 2000 });
  }, 20000);

  it('keeps each employee’s tours separate on a shared device', async () => {
    window.localStorage.setItem(progressKey('t1', 'u1'), JSON.stringify({ welcome: { version: 1, status: 'completed', step: 7, at: 'x' } }));
    state.user = { ...state.user, id: 'u2' };
    renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await waitForGuide(); // الموظف الثاني يرى جولته
    expect(within(card()).getByText(tour.welcome.intro.title)).toBeTruthy();
    expect(readProgress(progressKey('t1', 'u1')).welcome?.status).toBe('completed');
  }, 15000);

  it('stops the animation for people who ask for reduced motion', async () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
    renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await waitForGuide();
    next();
    await waitFor(() => expect(document.querySelector('[data-guide-spotlight]')).not.toBeNull());
    expect((document.querySelector('[data-guide-spotlight]') as HTMLElement).style.transition).toBe('none');
    expect(card().className).not.toContain('duration-200');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  }, 15000);

  it('pauses when the user leaves the screen, saving it as in progress', async () => {
    const view = renderIntl(<GuideProvider><Home /></GuideProvider>, 'en');
    await waitForGuide();
    next();
    state.pathname = '/fuel-stations/ops/shifts';
    view.rerender(<GuideProvider><Home /></GuideProvider>);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(readProgress(progressKey('t1', 'u1')).welcome).toMatchObject({ status: 'in_progress', step: 1 });
  }, 15000);
});

describe('AWJ Smart Guide — tours panel in the Help Center', () => {
  function Panel() {
    return <GuideProvider><GuideToursPanel /></GuideProvider>;
  }

  it('lists only the tours the user may see, with their status, and never the ones needing other permissions', () => {
    renderIntl(<Panel />, 'en');
    const names = [...document.querySelectorAll('[data-tour]')].map((el) => el.getAttribute('data-tour'));
    expect(names).toEqual(['welcome', 'shifts', 'sales', 'stock']); // بلا «التسليم»: لا fuel.shift.close
    expect(screen.queryByText(tour.collection.name)).toBeNull();
    expect(document.querySelector('[data-tour="welcome"]')!.getAttribute('data-tour-status')).toBe('new');
    expect(screen.getByText(M.guide.panel.persistNote)).toBeTruthy();
  });

  it('offers the handover tour with a way to reach its screen when the user can close shifts', () => {
    state.granted = [...state.granted, 'fuel.shift.close'];
    renderIntl(<Panel />, 'en');
    const row = document.querySelector('[data-tour="collection"]') as HTMLElement;
    expect(within(row).getByText(tour.collection.where)).toBeTruthy();
    expect(within(row).getByRole('link', { name: M.guide.panel.openScreen }).getAttribute('href')).toBe('/fuel-stations/ops/shifts');
    expect(within(row).queryByRole('button')).toBeNull(); // لا بدء مباشر من شاشة لا تحمل معرّف وردية
  });

  it('replays a completed tour: goes to the tour’s screen and starts it there', async () => {
    window.localStorage.setItem(progressKey('t1', 'u1'), JSON.stringify({ shifts: { version: 1, status: 'completed', step: 2, at: 'x' } }));
    renderIntl(<Panel />, 'en');
    const row = document.querySelector('[data-tour="shifts"]') as HTMLElement;
    expect(row.getAttribute('data-tour-status')).toBe('completed');
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: M.guide.panel.replay })); });
    expect(state.push).toHaveBeenCalledWith('/fuel-stations/ops/shifts');
  });

  it('resumes an in-progress tour from the saved step on its own screen', async () => {
    state.pathname = '/fuel-stations/ops';
    window.localStorage.setItem(progressKey('t1', 'u1'), JSON.stringify({ welcome: { version: 1, status: 'in_progress', step: 2, at: 'x' } }));
    renderIntl(<GuideProvider><Home /><GuideToursPanel /></GuideProvider>, 'en');
    const row = document.querySelector('[data-tour="welcome"]') as HTMLElement;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: M.guide.panel.resume })); });
    await waitForGuide();
    expect(within(card()).getByText('Step 3 of 8')).toBeTruthy();
  }, 15000);

  it('resume from another screen carries the saved step through the navigation (not restarting at step 1)', async () => {
    state.pathname = '/fuel-stations/ops/shifts';
    window.localStorage.setItem(progressKey('t1', 'u1'), JSON.stringify({ welcome: { version: 1, status: 'in_progress', step: 2, at: 'x' } }));
    const view = renderIntl(<GuideProvider><Home /><GuideToursPanel /></GuideProvider>, 'en');
    const row = document.querySelector('[data-tour="welcome"]') as HTMLElement;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: M.guide.panel.resume })); });
    expect(state.push).toHaveBeenCalledWith('/fuel-stations/ops');

    state.pathname = '/fuel-stations/ops'; // وصل المستخدم إلى الرئيسية
    view.rerender(<GuideProvider><Home /><GuideToursPanel /></GuideProvider>);
    await waitForGuide();
    expect(within(card()).getByText('Step 3 of 8')).toBeTruthy();
    expect(readProgress(progressKey('t1', 'u1')).welcome?.step).toBe(2);
  }, 15000);

  it('a plan still being built when the user leaves the screen never activates on the new screen', async () => {
    // لا عناصر إلا التنقل: الخطة تنتظر أول هدف (~2.5ث) ثم تكتمل غير فارغة — وقتها يكون المستخدم قد غادر.
    const Slow = () => <nav aria-label="Main">nav</nav>;
    const view = renderIntl(<GuideProvider><Slow /></GuideProvider>, 'en');
    await new Promise((resolve) => setTimeout(resolve, 1400)); // بدأ البدء التلقائي وخطته قيد الانتظار
    state.pathname = '/fuel-stations/ops/shifts';
    view.rerender(<GuideProvider><Slow /></GuideProvider>);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-smart-guide]')).toBeNull();
  }, 15000);

  it('offers “start this screen’s tour” in the contextual help only where a tour exists for the user', () => {
    state.pathname = '/fuel-stations/ops/products';
    const view = renderIntl(<GuideProvider><GuideScreenShortcut close={() => {}} /></GuideProvider>, 'en');
    expect(screen.getByRole('button', { name: M.guide.panel.startHere })).toBeTruthy();
    state.pathname = '/fuel-stations/ops/receiving';
    view.rerender(<GuideProvider><GuideScreenShortcut close={() => {}} /></GuideProvider>);
    expect(screen.queryByRole('button', { name: M.guide.panel.startHere })).toBeNull();
  });

  it('renders nothing outside the app shell (inert without the provider)', () => {
    function Probe() { return <div data-probe="">{String(useSmartGuide())}</div>; }
    renderIntl(<Probe />, 'en');
    expect(document.querySelector('[data-probe]')!.textContent).toBe('null');
  });
});
