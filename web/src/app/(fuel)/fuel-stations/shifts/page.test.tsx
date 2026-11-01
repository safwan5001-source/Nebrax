// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuelShiftsPage from './page';

const { api, currentUser, ApiErrorMock, translate } = vi.hoisted(() => ({
  api: vi.fn(), currentUser: vi.fn(), ApiErrorMock: class ApiError extends Error {},
  // مرجع ثابت: تبعيات useCallback في الصفحة تتضمن t فلا يجوز أن تتغير كل رسم.
  translate: (key: string, values?: Record<string, string>) => (values ? `${key}:${Object.values(values).join(',')}` : key),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock }));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return { ClipboardCheck: Icon, Droplets: Icon, Gauge: Icon, History: Icon, LockKeyhole: Icon, Plus: Icon, ReceiptText: Icon, WalletCards: Icon };
});
vi.mock('@/components/data-table', () => ({ DataTable: () => <table /> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ open, title, children }: { open: boolean; title?: string; children: React.ReactNode }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null) }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label> }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => <span /> }));
const success = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success }) }));

const lists: Record<string, unknown[]> = {
  '/fuel-stations/shifts': [],
  '/fuel-stations/stations': [{ id: 's1', name: 'محطة', code: 'C1', status: 'active' }],
  '/fuel-stations/nozzles': [],
  '/fuel-stations/tanks': [],
};

function mockApi(staffResult: 'ok' | 'fail', openResult: 'ok' | 'fail' = 'ok') {
  api.mockReset();
  api.mockImplementation((path: string, options?: { method?: string }) => {
    if (path === '/fuel-stations/shifts/open') return openResult === 'ok' ? Promise.resolve({ data: { id: 'sh1' } }) : Promise.reject(new ApiErrorMock('الوردية مفتوحة مسبقاً'));
    if (path.endsWith('/staff')) return staffResult === 'ok' ? Promise.resolve({}) : Promise.reject(new ApiErrorMock('المستخدم غير مؤهل'));
    if (options?.method === 'POST') return Promise.resolve({});
    return Promise.resolve({ data: lists[path] ?? [] });
  });
}

async function openShiftDialog() {
  const trigger = await screen.findByText('open');
  await waitFor(() => expect((trigger.closest('button') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'openTitle' });
  fireEvent.change(screen.getByLabelText('station'), { target: { value: 's1' } });
  return dialog;
}

describe('FuelShiftsPage open flow (UX-07, FS-29)', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React);
    currentUser.mockReturnValue({ id: 'u1', permissions: ['*'] });
    success.mockReset();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a failed staff-assignment step closes the dialog, reloads and shows the partial-success message', async () => {
    mockApi('fail');
    render(<FuelShiftsPage />);
    await openShiftDialog();
    fireEvent.click(screen.getByText('open', { selector: 'button[type="submit"]' }));

    await screen.findByText('openedStaffAssignmentFailed:المستخدم غير مؤهل');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(success).not.toHaveBeenCalled();
    // الوردية فُتحت فعلاً: إعادة تحميل القائمة بعد الفتح (لا حوار قديم يُعيد الإرسال).
    const opens = api.mock.calls.filter(([path]) => path === '/fuel-stations/shifts/open');
    expect(opens).toHaveLength(1);
    expect(api.mock.calls.filter(([path]) => path === '/fuel-stations/shifts').length).toBeGreaterThanOrEqual(2);
  });

  it('a failed open request shows exactly one alert, inside the still-open dialog', async () => {
    mockApi('ok', 'fail');
    render(<FuelShiftsPage />);
    const dialog = await openShiftDialog();
    fireEvent.click(screen.getByText('open', { selector: 'button[type="submit"]' }));

    await screen.findByText('الوردية مفتوحة مسبقاً');
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(dialog.contains(alerts[0])).toBe(true);
  });

  it('a fully successful open reports success without an error', async () => {
    mockApi('ok');
    render(<FuelShiftsPage />);
    await openShiftDialog();
    fireEvent.click(screen.getByText('open', { selector: 'button[type="submit"]' }));
    await waitFor(() => expect(success).toHaveBeenCalledWith('openedSuccess'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
