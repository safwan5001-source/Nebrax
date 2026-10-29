// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MappingPresetBar } from './MappingPresetBar';

const { api, translate } = vi.hoisted(() => ({
  api: vi.fn(),
  translate: (key: string, values: Record<string, unknown> = {}) => (Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => (typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : iconStub),
    has: () => true,
  });
});

const columns = [{ index: 0, header: 'رمز الصنف' }, { index: 1, header: 'الكمية' }, { index: 2, header: 'ملاحظة' }];
const fieldKeys = ['sku', 'quantity', 'unit_cost'];
const preset = (over: Record<string, unknown> = {}) => ({ id: 'p1', domain: 'stock_permit_import', name: 'مورد أ', columns: [{ header: 'رمز الصنف', field: 'sku' }], created_at: null, ...over });

function setup(over: Partial<React.ComponentProps<typeof MappingPresetBar>> = {}) {
  const onApply = vi.fn();
  render(<MappingPresetBar domain="stock_permit_import" columns={columns} mapping={{ 0: 'sku', 1: 'quantity', 2: null }} fieldKeys={fieldKeys} onApply={onApply} {...over} />);
  return onApply;
}

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path: string) => (path.startsWith('/import-mapping-presets?') ? Promise.resolve({ data: [preset()] }) : Promise.resolve({ data: {} })));
});
afterEach(cleanup);

describe('MappingPresetBar (IMP-H8-S2b)', () => {
  it('lists the domain presets and applies one by header through the server match', async () => {
    api.mockImplementation((path: string) => {
      if (path.startsWith('/import-mapping-presets?')) return Promise.resolve({ data: [preset()] });
      if (path === '/import-mapping-presets/p1/match') return Promise.resolve({ data: { mapping: { 0: null, 1: 'unit_cost', 2: null }, matched: 1, unmatched: [0, 2] } });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    const onApply = setup();
    await waitFor(() => expect(screen.getByRole('option', { name: 'مورد أ' })).toBeTruthy());
    expect(api).toHaveBeenCalledWith('/import-mapping-presets?domain=stock_permit_import');

    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByRole('combobox'), 'p1');
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const matchCall = api.mock.calls.find((call) => call[0] === '/import-mapping-presets/p1/match');
    expect(matchCall?.[1]).toMatchObject({ method: 'POST', body: { headers: ['رمز الصنف', 'الكمية', 'ملاحظة'] } });
    // العمود 1 طابق فأخذ المحفوظ؛ 0 و2 غير مطابقين فبقيا كما هما
    expect(onApply).toHaveBeenCalledWith({ 0: 'sku', 1: 'unit_cost', 2: null });
    expect(screen.getByText('applied:1,2')).toBeTruthy();
  });

  it('skips a saved field the current file contract does not know and says so', async () => {
    api.mockImplementation((path: string) => {
      if (path.startsWith('/import-mapping-presets?')) return Promise.resolve({ data: [preset()] });
      if (path.endsWith('/match')) return Promise.resolve({ data: { mapping: { 0: 'removed_field', 1: 'quantity', 2: null }, matched: 2, unmatched: [2] } });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    const onApply = setup();
    await waitFor(() => expect(screen.getByRole('option', { name: 'مورد أ' })).toBeTruthy());
    await user.selectOptions(screen.getByRole('combobox'), 'p1');
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ 0: null, 1: 'quantity', 2: null }));
    expect(screen.getByText(/dropped:1/)).toBeTruthy();
  });

  it('saves the current mapping by column header and selects the new preset', async () => {
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.startsWith('/import-mapping-presets?')) return Promise.resolve({ data: [] });
      if (path === '/import-mapping-presets' && options?.method === 'POST') return Promise.resolve({ data: preset({ id: 'p9', name: 'جديد' }) });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(screen.getByRole('option', { name: 'none_saved' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('save_as'), '  جديد ');
    await user.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(screen.getByRole('option', { name: 'جديد' })).toBeTruthy());
    const saveCall = api.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(saveCall?.[1].body).toEqual({
      domain: 'stock_permit_import', name: 'جديد',
      columns: [{ header: 'رمز الصنف', field: 'sku' }, { header: 'الكمية', field: 'quantity' }, { header: 'ملاحظة', field: null }],
    });
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('p9');
    expect((screen.getByLabelText('save_as') as HTMLInputElement).value).toBe('');
  });

  it('does not offer to save a mapping with nothing mapped', async () => {
    const user = userEvent.setup();
    setup({ mapping: { 0: null, 1: null, 2: null } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'مورد أ' })).toBeTruthy());
    await user.type(screen.getByLabelText('save_as'), 'x');
    expect((screen.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server refusal (duplicate name) and keeps the list unchanged', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.startsWith('/import-mapping-presets?')) return Promise.resolve({ data: [preset()] });
      if (options?.method === 'POST') return Promise.reject(new ApiError(422, 'توجد مطابقة بهذا الاسم', null));
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(screen.getByRole('option', { name: 'مورد أ' })).toBeTruthy());
    await user.type(screen.getByLabelText('save_as'), 'مورد أ');
    await user.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('توجد مطابقة بهذا الاسم'));
    expect(screen.getAllByRole('option').length).toBe(2);
  });

  it('deletes only after an explicit confirmation', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(screen.getByRole('option', { name: 'مورد أ' })).toBeTruthy());
    await user.selectOptions(screen.getByRole('combobox'), 'p1');
    await user.click(screen.getByRole('button', { name: 'delete' }));
    expect(api.mock.calls.some((call) => call[1]?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'confirm_delete' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/import-mapping-presets/p1', { method: 'DELETE' }));
    await waitFor(() => expect(screen.queryByRole('option', { name: 'مورد أ' })).toBeNull());
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  });

  it('stays hidden when the list cannot be loaded (including a permission refusal)', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockRejectedValue(new ApiError(403, 'ليس لديك صلاحية', null));
    setup();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });
});
