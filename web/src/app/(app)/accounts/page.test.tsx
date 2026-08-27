/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMock = vi.hoisted(() => vi.fn());

const translate = (key: string, values?: Record<string, string | number>) => {
    const labels: Record<string, string> = {
      title: 'دليل الحسابات', subtitle: 'شجرة الحسابات وأرصدتها الحالية.', search: 'بحث بالكود أو الاسم…',
      allBranches: 'كل الفروع', branchBalance: 'فرع القيود', add: 'إضافة حساب', tree: 'شجرة الحسابات',
      details: 'تفاصيل الحساب', actions: 'إجراءات', children: 'الحسابات الفرعية', balance: 'الرصيد',
      normalBalance: 'الطبيعة العادية', debit: 'مدين', credit: 'دائن', summary: 'تجميعي', posting: 'حركي',
      active: 'مفعّل', inactive: 'غير مفعّل', system: 'نظامي', empty: 'لا توجد حسابات', retry: 'إعادة المحاولة',
      loadFailed: 'تعذّر تحميل مساحة عمل الحسابات.', permissionDenied: 'لا تملك صلاحية عرض دليل الحسابات.',
      addChild: 'إضافة حساب فرعي', edit: 'تعديل الحساب', viewLedger: 'عرض كشف الأستاذ',
      searchResults: 'نتائج البحث', noSearchResults: 'لا توجد حسابات تطابق البحث.', searchPath: 'المسار',
      emptyChildrenTitle: 'لا توجد حسابات فرعية', emptyChildrenDescription: 'يمكنك إضافة أول حساب تحت هذا الحساب.',
      disabledAccount: 'هذا الحساب غير مفعّل ولا يقبل قيوداً جديدة.', protectedAccount: 'حساب نظامي محمي من التعديل؛ يمكنك إضافة حساب فرعي مخصص عند الحاجة.',
    };
    if (key === 'expand') return `توسيع ${values?.name}`;
    if (key === 'collapse') return `طي ${values?.name}`;
    if (key === 'childCount') return `${values?.count} حسابات فرعية`;
    return labels[key] ?? key;
  };

vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
  useTranslations: () => translate,
}));

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
  hasApiStatus: (error: unknown, status: number) => (error as { status?: number })?.status === status,
}));
vi.mock('@/lib/branch', () => ({ useBranches: () => ({ branches: [{ id: 'branch-1', code: '00001', name: 'الدمام', is_main: true, is_active: true }], loading: false }) }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'owner', permissions: ['*'] }) }));
vi.mock('@/components/accounts/account-dialog', () => ({
  AccountDialog: ({ open, initialParent }: { open: boolean; initialParent?: { id: string } | null }) => open ? <output data-testid="account-dialog-parent">{initialParent?.id ?? 'root'}</output> : null,
}));

import AccountsPage from './page';

const assets = {
  id: 'assets', parent_id: null, code: '1', name: 'الأصول', name_en: 'Assets', type: 'asset' as const,
  normal_balance: 'debit' as const, is_group: true, is_system: true, is_active: true, children_count: 1,
  has_entries: false, direct_balance: '0.00', aggregated_balance: '120.00', balance: '120.00',
  path: [{ id: 'assets', code: '1', name: 'الأصول' }],
};
const currentAssets = {
  ...assets, id: 'current-assets', parent_id: 'assets', code: '11', name: 'الأصول المتداولة', name_en: 'Current Assets',
  children_count: 1, aggregated_balance: '120.00', balance: '120.00',
  path: [...assets.path, { id: 'current-assets', code: '11', name: 'الأصول المتداولة' }],
};
const cash = {
  ...assets, id: 'cash', parent_id: 'current-assets', code: '1110', name: 'الصندوق', name_en: 'Cash',
  is_group: false, children_count: 0, has_entries: true, direct_balance: '120.00', aggregated_balance: '120.00', balance: '120.00',
  path: [...currentAssets.path, { id: 'cash', code: '1110', name: 'الصندوق' }],
};

function resolveWorkspace() {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/accounts/workspace')) return Promise.resolve({ data: [assets, currentAssets, cash] });
    return Promise.resolve({ data: { code: '111001' } });
  });
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe('AccountsPage', () => {
  it('يعرض الشجرة، يطوي ويوسع الحسابات، ويحدد الحساب المختار', async () => {
    resolveWorkspace();
    const user = userEvent.setup();
    render(<AccountsPage />);

    const tree = await screen.findByRole('tree', { name: 'شجرة الحسابات' });
    expect(within(tree).getByText('الأصول')).toBeTruthy();
    expect(within(tree).queryByText('الأصول المتداولة')).toBeNull();

    await user.click(within(tree).getByRole('button', { name: 'توسيع الأصول' }));
    expect(within(tree).getByText('الأصول المتداولة')).toBeTruthy();

    await user.click(within(tree).getByText('الأصول المتداولة'));
    expect(screen.getAllByText('الأصول المتداولة').length).toBeGreaterThan(1);
    expect(screen.getAllByText('#11').length).toBeGreaterThan(0);
  });

  it('يبحث بالاسم والكود ويعرض سياق المسار ثم يفتح إضافة ابن مع الأب المختار', async () => {
    resolveWorkspace();
    const user = userEvent.setup();
    render(<AccountsPage />);
    await screen.findByRole('tree');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '1110' } });
    await waitFor(() => expect(screen.getAllByText('الصندوق').length).toBeGreaterThan(0));
    expect(screen.getAllByText('الأصول ← الأصول المتداولة ← الصندوق').length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'إجراءات' })[0]);
    await user.click(screen.getByRole('menuitem', { name: 'إضافة حساب فرعي' }));
    expect(screen.getByTestId('account-dialog-parent').textContent).toBe('assets');
  });

  it('يعرض حالة رفض الصلاحية وحالة الفراغ بوضوح', async () => {
    apiMock.mockRejectedValueOnce({ status: 403, message: 'ممنوع' });
    render(<AccountsPage />);
    expect(await screen.findByText('لا تملك صلاحية عرض دليل الحسابات.')).toBeTruthy();

    cleanup();
    apiMock.mockImplementation(() => Promise.resolve({ data: [] }));
    render(<AccountsPage />);
    expect(await screen.findByText('لا توجد حسابات')).toBeTruthy();
  });
});
