// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductExportDialog } from './product-export-dialog';

const { downloadFile, translate, toast, toastSuccess, toastError } = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  toast: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) =>
      Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key,
    { raw: () => ({}), rich: (key: string) => key }
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('@/lib/api', () => ({
  downloadFile,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast, success: toastSuccess, error: toastError }),
}));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

const filterQuery = 'search=%D9%82%D9%87%D9%88%D8%A9&sort=-sale_price&type=good&sale_price_gte=20';

function renderDialog(props: Partial<React.ComponentProps<typeof ProductExportDialog>> = {}) {
  return render(
    <ProductExportDialog
      open
      onClose={props.onClose ?? vi.fn()}
      filterQuery={props.filterQuery ?? filterQuery}
      selectedIds={props.selectedIds ?? []}
      filteredTotal={props.filteredTotal ?? 42}
    />
  );
}

/** يستخرج معاملات الاستدعاء الأخير لـ`downloadFile`. */
function lastParams(): URLSearchParams {
  const path = downloadFile.mock.calls.at(-1)?.[0] as string;
  return new URLSearchParams(path.split('?')[1] ?? '');
}

beforeEach(() => {
  downloadFile.mockReset();
  downloadFile.mockResolvedValue('downloaded');
  toast.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(cleanup);

describe('حوار تصدير المنتجات', () => {
  it('لا يعرض نطاق «المحدد» حين لا يوجد تحديد', () => {
    renderDialog({ selectedIds: [] });

    expect(screen.queryByLabelText('export_scope_selected')).toBeNull();
    expect(screen.getByLabelText('export_scope_filtered')).toBeTruthy();
    expect(screen.getByLabelText('export_scope_all')).toBeTruthy();
    expect(screen.getByText('export_no_selection')).toBeTruthy();
  });

  it('يعرض عدد المنتجات المحددة حين يوجد تحديد', () => {
    renderDialog({ selectedIds: ['a', 'b'] });

    expect(screen.getByLabelText('export_scope_selected')).toBeTruthy();
    expect(screen.getByText('export_scope_selected_hint:2')).toBeTruthy();
  });

  it('يمرّر مرشّحات القائمة كاملةً بلا معاملات تقسيم', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = lastParams();
    expect(params.get('scope')).toBe('filtered');
    expect(params.get('type')).toBe('good');
    expect(params.get('sale_price_gte')).toBe('20');
    expect(params.get('sort')).toBe('-sale_price');
    expect(params.get('search')).toBe('قهوة');
    expect(params.get('page')).toBeNull();
    expect(params.get('per_page')).toBeNull();
  });

  it('يُسقط مرشّحات القائمة حين يكون النطاق «الكل»', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByLabelText('export_scope_all'));
    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = lastParams();
    expect(params.get('scope')).toBe('all');
    expect(params.get('type')).toBeNull();
    expect(params.get('search')).toBeNull();
  });

  it('يرسل معرّفات المنتجات المحددة وحدها', async () => {
    const user = userEvent.setup();
    renderDialog({ selectedIds: ['id-1', 'id-2'] });

    await user.click(screen.getByLabelText('export_scope_selected'));
    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = lastParams();
    expect(params.get('scope')).toBe('selected');
    expect(params.getAll('ids[]')).toEqual(['id-1', 'id-2']);
    expect(params.get('type')).toBeNull();
  });

  it('يدعم قالب round-trip وصيغتَي CSV وXLSX', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(screen.getByLabelText('export_template'), 'round_trip');
    await user.selectOptions(screen.getByLabelText('export_format'), 'csv');
    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = lastParams();
    expect(params.get('template')).toBe('round_trip');
    expect(params.get('format')).toBe('csv');
    expect(screen.getByText('export_template_round_trip_hint')).toBeTruthy();
  });

  it('يبلّغ فشل التصدير بدل ابتلاعه', async () => {
    downloadFile.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('export_failed'));
  });

  it('يعلن النجاح ويغلق الحوار حين يتم التنزيل فعلاً', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onClose });

    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('export_success'));
    expect(onClose).toHaveBeenCalled();
  });

  // انحدار: وضع المعاينة لا ينزّل شيئاً، فادّعاء النجاح فيه كذبٌ صريح.
  it('لا يدّعي نجاحاً في وضع المعاينة، بل يقول إن التصدير غير متاح', async () => {
    downloadFile.mockResolvedValue('demo-unavailable');
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onClose });

    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: 'export_demo_unavailable', variant: 'info' })
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    // الحوار يبقى مفتوحاً: ما طلبه المستخدم لم يحدث.
    expect(onClose).not.toHaveBeenCalled();
    // ولا يظل الزر معطّلاً بعد الرسالة.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'export_submit' }).hasAttribute('disabled')).toBe(false)
    );
  });

  it('لا يعرض نصاً عربياً مكتوباً في الشيفرة داخل واجهة مترجَمة', () => {
    const { container } = renderDialog({ selectedIds: ['a'] });

    const chrome = [...container.querySelectorAll('label, button, legend, p, span, option')].map(
      (node) => node.textContent ?? ''
    );
    expect(chrome.some((text) => /[؀-ۿ]/.test(text))).toBe(false);
  });
});
