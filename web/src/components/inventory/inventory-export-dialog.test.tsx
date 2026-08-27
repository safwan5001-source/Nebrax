// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryExportDialog } from './inventory-export-dialog';

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

const state = {
  search: 'إسمنت',
  sort: '-quantity_on_hand',
  filters: { unit: 'كيس', qty_min: '10' },
};

function renderDialog(props: Partial<React.ComponentProps<typeof InventoryExportDialog>> = {}) {
  return render(
    <InventoryExportDialog
      open
      onClose={props.onClose ?? vi.fn()}
      state={props.state ?? state}
      filteredCount={props.filteredCount ?? 12}
      totalCount={props.totalCount ?? 40}
    />
  );
}

/** معاملات آخر استدعاء لـ`downloadFile`. */
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

describe('حوار تصدير أرصدة المخزون', () => {
  it('يعرض نطاقَي «الحالي» و«الكل» بعدّاديهما', () => {
    renderDialog();
    expect(screen.getByLabelText('export_scope_filtered')).toBeTruthy();
    expect(screen.getByText('export_scope_filtered_hint:12')).toBeTruthy();
    expect(screen.getByLabelText('export_scope_all')).toBeTruthy();
    expect(screen.getByText('export_scope_all_hint:40')).toBeTruthy();
  });

  it('يمرّر مرشّحات الشاشة في النطاق المفلتر بلا معاملات تقسيم', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = lastParams();
    expect(params.get('scope')).toBe('filtered');
    expect(params.get('search')).toBe('إسمنت');
    expect(params.get('unit')).toBe('كيس');
    expect(params.get('qty_min')).toBe('10');
    expect(params.get('format')).toBe('xlsx');
    expect(params.get('include_zero')).toBe('1');
    expect(params.get('page')).toBeNull();
    expect(params.get('per_page')).toBeNull();
  });

  it('يُسقط المرشّحات في نطاق «الكل» ويدعم CSV', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByLabelText('export_scope_all'));
    await user.selectOptions(screen.getByLabelText('export_format'), 'csv');
    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = lastParams();
    expect(params.get('scope')).toBe('all');
    expect(params.get('format')).toBe('csv');
    expect(params.get('search')).toBeNull();
    expect(params.get('unit')).toBeNull();
  });

  it('يعكس خيار الرصيد الصفري في المعامل', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByLabelText('export_include_zero'));
    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    expect(lastParams().get('include_zero')).toBe('0');
  });

  it('يعلن النجاح ويغلق الحوار عند التنزيل الفعلي', async () => {
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
    expect(onClose).not.toHaveBeenCalled();
  });

  it('يبلّغ فشل التصدير بدل ابتلاعه', async () => {
    downloadFile.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'export_submit' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('export_failed'));
  });

  it('لا يرسل إلا طلب تنزيل واحد مهما تكرّر النقر', async () => {
    let resolveDownload: (value: unknown) => void = () => {};
    downloadFile.mockReturnValue(new Promise((resolve) => { resolveDownload = resolve; }));
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'export_submit' }));
    // الزرّ صار معطَّلاً أثناء العمل، فالنقرات التالية لا تُطلق طلباً.
    const busy = screen.getByRole('button', { name: 'export_working' });
    expect(busy.hasAttribute('disabled')).toBe(true);
    await user.click(busy);
    await user.click(busy);

    expect(downloadFile).toHaveBeenCalledTimes(1);
    resolveDownload('downloaded');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('لا يعرض نصاً عربياً مكتوباً في الشيفرة داخل واجهة مترجَمة', () => {
    const { container } = renderDialog();
    const chrome = [...container.querySelectorAll('label, button, legend, p, span, option')].map(
      (node) => node.textContent ?? ''
    );
    expect(chrome.some((text) => /[؀-ۿ]/.test(text))).toBe(false);
  });
});
