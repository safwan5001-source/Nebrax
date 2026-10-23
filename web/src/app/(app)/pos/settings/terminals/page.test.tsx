// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PosTerminalsPage from './page';

const { api, can } = vi.hoisted(() => ({ api: vi.fn(), can: vi.fn() }));

const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ can, hydrated: true }) }));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error { status = 422; body: unknown = null; },
}));
vi.mock('@/components/data-table', () => ({
  DataTable: ({ columns, data }: { columns: Array<{ id?: string; accessorKey?: string; cell?: (ctx: { row: { original: unknown } }) => ReactNode }>; data: unknown[] }) => (
    <div>{data.map((row, index) => <div key={index} data-testid="terminal-row">{columns.map((column, i) => <span key={i}>{column.cell?.({ row: { original: row } })}</span>)}</div>)}</div>
  ),
}));

const terminal = { id: 't1', name: 'Terminal A', code: 'SN-1', provider: 'fake', simulated: true, pos_device_id: 'd1', is_active: true, created_at: null };

function mock(list: unknown[], providers: unknown[]) {
  api.mockImplementation(async (path: string) => {
    if (path === '/pos-payment-terminals') return { data: list, meta: { providers } };
    if (path === '/pos-devices') return { data: [{ id: 'd1', name: 'Counter 1', code: null, is_active: true }] };
    throw new Error(`unexpected ${path}`);
  });
}

describe('صفحة أجهزة دفع البطاقات', () => {
  beforeEach(() => { api.mockReset(); can.mockReset(); can.mockReturnValue(true); });
  afterEach(() => cleanup());

  it('لا مزوّد متاح (الإنتاج قبل H6-03): ملاحظة صريحة وزر الإضافة معطّل', async () => {
    mock([], []);
    render(<PosTerminalsPage />);
    expect(await screen.findByTestId('pos-terminals-no-provider')).toBeTruthy();
    expect((screen.getByRole('button', { name: /add/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('جهاز المحاكاة يُعلَّم صراحةً مع ملاحظة بيئة المحاكاة، ويظهر ربطه بجهاز POS', async () => {
    mock([terminal], [{ key: 'fake', simulated: true }]);
    render(<PosTerminalsPage />);
    expect(await screen.findByText('Terminal A')).toBeTruthy();
    expect(screen.getByText('simulated')).toBeTruthy();
    expect(screen.getByTestId('pos-terminals-simulated-note')).toBeTruthy();
    expect(screen.getByText('Counter 1')).toBeTruthy();
    expect((screen.getByRole('button', { name: /add/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('بلا صلاحية الإدارة: عرض فقط بلا إضافة ولا تعديل', async () => {
    can.mockReturnValue(false);
    mock([terminal], [{ key: 'fake', simulated: true }]);
    render(<PosTerminalsPage />);
    await screen.findByText('Terminal A');
    expect(screen.queryByRole('button', { name: /add/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit/ })).toBeNull();
    expect(screen.getByText('read_only')).toBeTruthy();
  });

  it('الإنشاء يرسل المزوّد المتاح وربط الجهاز', async () => {
    mock([], [{ key: 'fake', simulated: true }]);
    render(<PosTerminalsPage />);
    await waitFor(() => expect((screen.getByRole('button', { name: /add/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /add/ }));
    fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'New terminal' } });
    fireEvent.change(screen.getByLabelText('device'), { target: { value: 'd1' } });
    api.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return { data: terminal };
      if (path === '/pos-payment-terminals') return { data: [terminal], meta: { providers: [{ key: 'fake', simulated: true }] } };
      return { data: [] };
    });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => {
      const post = api.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post?.[1].body).toEqual({ name: 'New terminal', code: null, pos_device_id: 'd1', is_active: true, provider: 'fake' });
    });
  });
});
