// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenSellingSessionPage from './page';

const { api, replace, searchParams, MockApiError, locale } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown = {}) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return {
    api: vi.fn(),
    replace: vi.fn(),
    searchParams: new URLSearchParams(),
    MockApiError,
    locale: { current: 'ar' as 'ar' | 'en' },
  };
});

const strings = {
  ar: {
    posOpenSession: {
      title: 'فتح جلسة بيع',
      description: 'اختر جهاز نقطة البيع ووردية العمل، ثم أدخل العهدة النقدية الافتتاحية قبل بدء البيع.',
      device: 'جهاز نقطة البيع',
      select_device: 'اختر جهازاً',
      no_device: 'لا يوجد جهاز نقطة بيع نشط في هذا الفرع.',
      pos_shift: 'وردية نقاط البيع',
      select_shift: 'اختر وردية',
      no_shift: 'لا توجد وردية نقاط بيع نشطة في هذا الفرع.',
      opening_cash: 'العهدة النقدية الافتتاحية',
      opening_cash_hint: 'المبلغ النقدي المستلم في بداية الوردية',
      submit: 'فتح الجلسة وبدء البيع',
      cancel: 'إلغاء',
      resuming: 'توجد جلسة بيع مفتوحة. افتح نقطة البيع في تبويب مخصّص.',
      open_pos_tab: 'فتح نقطة البيع',
      popup_blocked: 'منع المتصفح فتح تبويب نقطة البيع تلقائياً. استخدم الزر أدناه.',
      session_closed_remote: 'أُغلقت وردية نقطة البيع من مكان آخر. افتح جلسة جديدة للمتابعة.',
      device_required: 'الجهاز مطلوب.',
      shift_required: 'وردية نقاط البيع مطلوبة.',
      opening_balance_invalid: 'أدخل مبلغاً صالحاً لا يقل عن صفر.',
    },
    common: { loading: 'جارٍ التحميل…', loadFailed: 'تعذّر التحميل', saveFailed: 'تعذّر الحفظ', retry: 'إعادة المحاولة' },
  },
  en: {
    posOpenSession: {
      title: 'Open Selling Session',
      description: 'Select the POS device and work shift, then enter the opening cash float before selling.',
      device: 'POS device',
      select_device: 'Select a device',
      no_device: 'No active POS device is available in this branch.',
      pos_shift: 'POS shift',
      select_shift: 'Select a shift',
      no_shift: 'No active POS shift is available in this branch.',
      opening_cash: 'Opening cash float',
      opening_cash_hint: 'Cash received at the start of the shift',
      submit: 'Open Session & Start Selling',
      cancel: 'Cancel',
      resuming: 'An open selling session is already available. Open POS in a dedicated tab.',
      open_pos_tab: 'Open POS',
      popup_blocked: 'The browser blocked the automatic POS tab. Use the button below.',
      session_closed_remote: 'The POS shift was closed elsewhere. Open a new session to continue.',
      device_required: 'Device is required.',
      shift_required: 'POS shift is required.',
      opening_balance_invalid: 'Enter a valid amount that is not negative.',
    },
    common: { loading: 'Loading…', loadFailed: 'Could not load', saveFailed: 'Could not save', retry: 'Retry' },
  },
} as const;

vi.mock('next-intl', () => ({
  useTranslations: (namespace: 'posOpenSession' | 'common') => (key: string) => strings[locale.current][namespace][key as never] ?? key,
  useLocale: () => locale.current,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: MockApiError,
  hasApiStatus: (error: unknown, status: number) => (error as { status?: number })?.status === status,
}));

const devices = [
  { id: 'device-1', name: 'Counter 1', code: 'POS-01', is_active: true, warehouse: { id: 'wh-1', name: 'Main', code: '00001' } },
  { id: 'device-off', name: 'Disabled counter', code: 'POS-00', is_active: false, warehouse: null },
];
const shifts = [
  { id: 'pos-shift-morning', name: 'Morning', code: 'MORNING', is_active: true },
  { id: 'pos-shift-evening', name: 'Evening', code: 'EVENING', is_active: false },
];

let mine: Array<{ id: string; status: string }> = [];
const openBodies: unknown[] = [];
let openImpl: ((body: unknown) => Promise<unknown>) | null = null;
let posWin: { closed: boolean; close: ReturnType<typeof vi.fn>; location: { replace: ReturnType<typeof vi.fn> } };

function mockApi(url: string, options?: { method?: string; body?: unknown }) {
  if (String(url).startsWith('/pos-sessions?mine=1')) return Promise.resolve({ data: mine });
  if (url === '/pos-devices') return Promise.resolve({ data: devices });
  if (url === '/pos-shifts') return Promise.resolve({ data: shifts });
  if (url === '/pos-sessions/open') {
    openBodies.push(options?.body);
    return openImpl ? openImpl(options?.body) : Promise.resolve({ data: { id: 'opened', status: 'open' } });
  }
  return Promise.reject(new Error(`unexpected ${url}`));
}

function mockPosWindow() {
  posWin = {
    closed: false,
    close: vi.fn(function (this: { closed: boolean }) { this.closed = true; }),
    location: { replace: vi.fn() },
  };
  vi.spyOn(window, 'open').mockImplementation(() => posWin as unknown as Window);
}

async function renderForm() {
  render(<OpenSellingSessionPage />);
  await waitFor(() => expect(screen.getByLabelText(strings[locale.current].posOpenSession.device)).toBeTruthy());
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, openingCash = '0') {
  await user.selectOptions(screen.getByLabelText(strings[locale.current].posOpenSession.device), 'device-1');
  await user.selectOptions(screen.getByLabelText(strings[locale.current].posOpenSession.pos_shift), 'pos-shift-morning');
  const cash = screen.getByLabelText(strings[locale.current].posOpenSession.opening_cash);
  await user.clear(cash);
  await user.type(cash, openingCash);
}

function expectPosTabAssigned() {
  expect(window.open).toHaveBeenCalledWith('about:blank', 'awj-pos-workspace');
  expect(posWin.location.replace).toHaveBeenCalledWith('/pos');
  expect(posWin.close).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalledWith('/pos');
}

describe('صفحة فتح جلسة البيع', () => {
  beforeEach(() => {
    locale.current = 'ar';
    mine = [];
    openBodies.length = 0;
    openImpl = null;
    searchParams.delete('reason');
    replace.mockReset();
    api.mockReset();
    api.mockImplementation(mockApi);
    mockPosWindow();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('تعرض العناوين العربية وRTL ولا تدخل POS قبل الفتح', async () => {
    await renderForm();
    const page = screen.getByTestId('pos-open-session-page');
    expect(page.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'فتح جلسة بيع' })).toBeTruthy();
    expect(screen.getByText('العهدة النقدية الافتتاحية')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'فتح الجلسة وبدء البيع' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'إلغاء' }).getAttribute('href')).toBe('/dashboard');
    expect(replace).not.toHaveBeenCalledWith('/pos');
    expect(window.open).not.toHaveBeenCalled();
    expect(openBodies).toHaveLength(0);
  });

  it('تعرض العناوين الإنجليزية وLTR', async () => {
    locale.current = 'en';
    await renderForm();
    expect(screen.getByTestId('pos-open-session-page').getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('heading', { name: 'Open Selling Session' })).toBeTruthy();
    expect(screen.getByText('Opening cash float')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Session & Start Selling' })).toBeTruthy();
  });

  it('تجعل الجهاز ووردية POS إلزاميين ولا ترسل بلاهما', async () => {
    await renderForm();
    const submit = screen.getByRole('button', { name: 'فتح الجلسة وبدء البيع' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(submit.closest('form')!);
    expect(openBodies).toHaveLength(0);
    expect(window.open).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalledWith('/pos');
    expect(screen.queryByRole('option', { name: /Disabled counter/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Evening/ })).toBeNull();
  });

  it('يرسل pos_shift_id والهللات بما فيها الصفر ولا يرسل shift_id ثم يفتح /pos في تبويب جديد', async () => {
    const user = userEvent.setup();
    await renderForm();
    await fillRequired(user, '0');
    await user.click(screen.getByRole('button', { name: 'فتح الجلسة وبدء البيع' }));
    await waitFor(() => expect(openBodies).toHaveLength(1));
    expect(openBodies[0]).toEqual({
      opening_balance: 0,
      pos_device_id: 'device-1',
      pos_shift_id: 'pos-shift-morning',
    });
    expect(JSON.stringify(openBodies[0])).not.toMatch(/(?:^|[^a-z_])shift_id(?:[^a-z_]|$)/);
    await waitFor(() => expect(posWin.location.replace).toHaveBeenCalledWith('/pos'));
    expectPosTabAssigned();
  });

  it('يحوّل العهدة 100.50 إلى 10050 هللة', async () => {
    const user = userEvent.setup();
    await renderForm();
    await fillRequired(user, '100.50');
    await user.click(screen.getByRole('button', { name: 'فتح الجلسة وبدء البيع' }));
    await waitFor(() => expect(openBodies).toEqual([{
      opening_balance: 10050,
      pos_device_id: 'device-1',
      pos_shift_id: 'pos-shift-morning',
    }]));
    await waitFor(() => expect(posWin.location.replace).toHaveBeenCalledWith('/pos'));
  });

  it('يمنع الإرسال المزدوج', async () => {
    const user = userEvent.setup();
    let release: ((value: unknown) => void) | undefined;
    openImpl = () => new Promise((resolve) => { release = resolve; });
    await renderForm();
    await fillRequired(user, '10');
    const submit = screen.getByRole('button', { name: 'فتح الجلسة وبدء البيع' });
    await user.click(submit);
    await user.click(submit);
    await waitFor(() => expect(openBodies).toHaveLength(1));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(posWin.location.replace).not.toHaveBeenCalled();
    release?.({ data: { id: 'opened', status: 'open' } });
    await waitFor(() => expect(posWin.location.replace).toHaveBeenCalledWith('/pos'));
    expect(replace).not.toHaveBeenCalledWith('/pos');
  });

  it('لا يدخل POS عند فشل API ويغلق التبويب النائب', async () => {
    const user = userEvent.setup();
    openImpl = () => Promise.reject(new MockApiError(500, 'تعذر فتح الجلسة'));
    await renderForm();
    await fillRequired(user, '10');
    await user.click(screen.getByRole('button', { name: 'فتح الجلسة وبدء البيع' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('تعذر فتح الجلسة'));
    expect(window.open).toHaveBeenCalledWith('about:blank', 'awj-pos-workspace');
    expect(posWin.close).toHaveBeenCalled();
    expect(posWin.location.replace).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalledWith('/pos');
    expect(screen.getByLabelText('جهاز نقطة البيع')).toBeTruthy();
  });

  it('يتبنّى الجلسة المفتوحة القائمة دون POST ويعرض رابط تبويب جديد', async () => {
    mine = [{ id: 'open-1', status: 'open' }];
    render(<OpenSellingSessionPage />);
    await waitFor(() => expect(screen.getByTestId('pos-resume-selling')).toBeTruthy());
    const resume = screen.getByTestId('pos-resume-selling');
    expect(resume.getAttribute('href')).toBe('/pos');
    expect(resume.getAttribute('target')).toBe('_blank');
    expect(resume.getAttribute('rel')).toBe('noopener noreferrer');
    expect(openBodies).toHaveLength(0);
    expect(window.open).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalledWith('/pos');
    expect(screen.queryByRole('button', { name: 'فتح الجلسة وبدء البيع' })).toBeNull();
  });

  it('عند 422 يعيد تبنّي الجلسة القائمة إن وُجدت ويفتح /pos في التبويب المخصص', async () => {
    const user = userEvent.setup();
    openImpl = () => {
      mine = [{ id: 'open-1', status: 'open' }];
      return Promise.reject(new MockApiError(422, 'لدى الكاشير جلسة نقطة بيع مفتوحة بالفعل — أغلقها قبل فتح جلسة على جهاز آخر.'));
    };
    await renderForm();
    await fillRequired(user, '0');
    await user.click(screen.getByRole('button', { name: 'فتح الجلسة وبدء البيع' }));
    await waitFor(() => expect(posWin.location.replace).toHaveBeenCalledWith('/pos'));
    expectPosTabAssigned();
    expect(screen.queryByRole('alert')?.textContent ?? '').not.toContain('لدى الكاشير');
  });

  it('عند حظر التبويب بعد نجاح الفتح يعرض رابط الاستئناف ولا يفتح POS في نفس التبويب', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'open').mockReturnValue(null);
    await renderForm();
    await fillRequired(user, '0');
    await user.click(screen.getByRole('button', { name: 'فتح الجلسة وبدء البيع' }));
    await waitFor(() => expect(openBodies).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('pos-resume-selling')).toBeTruthy());
    expect(screen.getByTestId('pos-popup-blocked')).toBeTruthy();
    expect(replace).not.toHaveBeenCalledWith('/pos');
  });

  it('تعرض سبب الإغلاق عن بُعد دون إنشاء جلسة', async () => {
    searchParams.set('reason', 'closed');
    await renderForm();
    expect(screen.getByTestId('pos-session-invalid-banner').textContent).toContain('أُغلقت وردية');
    expect(openBodies).toHaveLength(0);
  });
});
