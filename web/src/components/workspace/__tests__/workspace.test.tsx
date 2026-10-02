import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { LifecycleRail } from '../lifecycle-rail';
import { SALES_INVOICE_LIFECYCLE } from '../lifecycle';
import { TotalsDock } from '../totals-dock';
import { PostedEntries } from '../posted-entries';
import { LineGrid, LineGridRow, LineGridView } from '../line-grid';
import { WorkspaceTabs } from '../document-workspace';
import { formatRiyal } from '@/lib/money';

const labels: Record<string, string> = { draft: 'مسودة', posted: 'مرحّلة', cancelled: 'ملغاة', unpaid: 'غير مدفوعة', partial: 'جزئي', paid: 'مسدّدة' };
const stateLabel = (s: string) => labels[s] ?? s;
const messages = { nebrax: { documentSections: 'أقسام المستند' } };

afterEach(cleanup);

describe('LifecycleRail', () => {
  const rail = (status: string, paymentStatus?: string | null) =>
    render(
      <LifecycleRail
        definition={SALES_INVOICE_LIFECYCLE}
        status={status}
        paymentStatus={paymentStatus}
        stateLabel={stateLabel}
        documentAriaLabel="doc"
        paymentAriaLabel="pay"
      />
    );

  it('draft: shows only the stored sequence, current step marked, no payment axis', () => {
    rail('draft', 'unpaid');
    const list = screen.getByRole('list', { name: 'doc' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent?.replace('✓ ', ''))).toEqual(['مسودة', 'مرحّلة']);
    expect(list.querySelector('[aria-current="step"]')?.textContent).toBe('مسودة');
    expect(screen.queryByRole('list', { name: 'pay' })).toBeNull();
  });

  it('posted: first step done (check text), payment axis shows the server payment_status', () => {
    rail('posted', 'partial');
    const doc = screen.getByRole('list', { name: 'doc' });
    expect(doc.querySelector('[data-awj-step="done"]')?.textContent).toContain('مسودة');
    const pay = screen.getByRole('list', { name: 'pay' });
    expect(pay.querySelector('[aria-current="step"]')?.textContent).toBe('جزئي');
  });

  it('cancelled: terminal state replaces the path and hides payment', () => {
    rail('cancelled', 'unpaid');
    const items = within(screen.getByRole('list', { name: 'doc' })).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe('ملغاة');
    expect(screen.queryByRole('list', { name: 'pay' })).toBeNull();
  });

  it('an unknown status is shown as-is, never mapped onto a known state', () => {
    rail('issued');
    const items = within(screen.getByRole('list', { name: 'doc' })).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe('issued');
  });
});

describe('TotalsDock', () => {
  const cells = [
    { key: 'subtotal', label: 'الإجمالي قبل الخصم', value: '5000.00' },
    { key: 'discount', label: 'الخصم', value: '250.00' },
    { key: 'shipping', label: 'الشحن', value: '50.00' },
    { key: 'tax', label: 'الضريبة', value: '750.00' },
    { key: 'adjustment', label: 'التسوية', value: '1.25' },
  ];

  it('presents the given values verbatim (no recomputation) via <Money>', () => {
    render(<TotalsDock ariaLabel="ملخص" cells={cells} outcome={{ label: 'الإجمالي المستحق', value: '5551.25' }} detailLabel="تفصيل" />);
    const region = screen.getByRole('region', { name: 'ملخص' });
    expect(region.querySelector('[data-awj-dock-outcome-value]')?.textContent).toBe(formatRiyal('5551.25'));
  });

  it('keeps every figure: overflow cells are reachable in the detail popover', () => {
    render(<TotalsDock ariaLabel="ملخص" cells={cells} outcome={{ label: 'x', value: 1 }} detailLabel="تفصيل" />);
    fireEvent.click(screen.getByRole('button', { name: /تفصيل/ }));
    const popover = screen.getByRole('group', { name: 'تفصيل' });
    expect(within(popover).getAllByText(/\d/).length).toBeGreaterThanOrEqual(cells.length);
    expect(popover.textContent).toContain(formatRiyal('1.25'));
  });

  it('Escape closes the detail popover', () => {
    render(<TotalsDock ariaLabel="ملخص" cells={cells} outcome={{ label: 'x', value: 1 }} detailLabel="تفصيل" />);
    fireEvent.click(screen.getByRole('button', { name: /تفصيل/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'تفصيل' })).toBeNull();
  });

  it('has no primary action button (only the detail disclosure)', () => {
    render(<TotalsDock ariaLabel="ملخص" cells={cells.slice(0, 2)} outcome={{ label: 'x', value: 1 }} detailLabel="تفصيل" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('PostedEntries', () => {
  const labelsEntries = { entryNumber: 'رقم القيد', entryDate: 'التاريخ', description: 'الوصف', account: 'الحساب', debit: 'مدين', credit: 'دائن', openEntry: 'فتح القيد', readOnly: 'للقراءة فقط' };
  const entry = {
    id: 'e1', number: 'JE-1', date: '2026-06-24', status: 'posted', description: null,
    lines: [
      { account_id: 'a1', account_code: '1130', account_name: 'العملاء', description: null, debit: '5750.00', credit: '0.00' },
      { account_id: 'a2', account_code: '4110', account_name: 'إيرادات', description: null, debit: '0.00', credit: '5000.00' },
    ],
  };

  it('renders server lines verbatim and links to the entry; performs no totals', () => {
    render(
      <PostedEntries groups={[{ key: 's', title: 'قيد المبيعات', entry, empty: 'لا قيد' }]} labels={labelsEntries} statusLabel={stateLabel} statusTone={() => 'positive'} />
    );
    expect(screen.getByText('JE-1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'فتح القيد' }).getAttribute('href')).toBe('/journal-entries/e1');
    // 2 lines × 2 amounts, nothing extra (no total row)
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(document.querySelector('tfoot')).toBeNull();
  });

  it('missing entry shows the explicit empty message and nothing is inferred', () => {
    render(
      <PostedEntries groups={[{ key: 'c', title: 'قيد التكلفة', entry: null, empty: 'لا يوجد قيد تكلفة' }]} labels={labelsEntries} statusLabel={stateLabel} statusTone={() => 'muted'} />
    );
    expect(screen.getByText('لا يوجد قيد تكلفة')).toBeTruthy();
    expect(document.querySelector('table')).toBeNull();
  });
});

describe('LineGridView', () => {
  const rows = [{ id: '1', name: 'خدمات', qty: 2, total: '2300.00' }];
  it('renders columns by priority and shows the derived-value footer note', () => {
    render(
      <LineGridView
        ariaLabel="البنود"
        rows={rows}
        getKey={(r) => r.id}
        footerNote="الحقول المحسوبة مشتقّة"
        columns={[
          { id: 'name', header: 'الصنف', cell: (r) => r.name },
          { id: 'qty', header: 'الكمية', align: 'end', priority: 'p2', cell: (r) => r.qty },
          { id: 'total', header: 'الإجمالي', align: 'end', derived: true, cell: (r) => r.total },
        ]}
      />
    );
    expect(screen.getByRole('table', { name: 'البنود' })).toBeTruthy();
    expect(screen.getByText('الحقول المحسوبة مشتقّة')).toBeTruthy();
    expect(screen.getByText('2300.00')).toBeTruthy();
  });
});

describe('LineGrid keyboard (v3 gate)', () => {
  function Grid({ onAdd }: { onAdd: () => void }) {
    return (
      <LineGrid onAddLine={onAdd}>
        {[0, 1].map((i) => (
          <LineGridRow key={i}>
            <div data-awj-col="qty"><input aria-label={`qty-${i}`} /></div>
            <div data-awj-col="price"><input aria-label={`price-${i}`} /></div>
          </LineGridRow>
        ))}
      </LineGrid>
    );
  }

  it('gate OFF: Alt+N and Alt+Arrow do nothing', () => {
    document.documentElement.removeAttribute('data-awj-ui');
    const onAdd = vi.fn();
    render(<Grid onAdd={onAdd} />);
    const qty0 = screen.getByLabelText('qty-0');
    qty0.focus();
    fireEvent.keyDown(qty0, { key: 'n', altKey: true });
    fireEvent.keyDown(qty0, { key: 'ArrowDown', altKey: true });
    expect(onAdd).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(qty0);
  });

  it('gate ON: Alt+N adds a line; Alt+ArrowDown/Up moves within the same column', () => {
    document.documentElement.setAttribute('data-awj-ui', '3');
    const onAdd = vi.fn();
    render(<Grid onAdd={onAdd} />);
    const price0 = screen.getByLabelText('price-0');
    price0.focus();
    fireEvent.keyDown(price0, { key: 'n', altKey: true });
    expect(onAdd).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(price0, { key: 'ArrowDown', altKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText('price-1'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp', altKey: true });
    expect(document.activeElement).toBe(price0);
    document.documentElement.removeAttribute('data-awj-ui');
  });

  it('plain arrow keys are never intercepted (inputs keep their native behaviour)', () => {
    document.documentElement.setAttribute('data-awj-ui', '3');
    render(<Grid onAdd={() => {}} />);
    const qty0 = screen.getByLabelText('qty-0');
    qty0.focus();
    const notPrevented = fireEvent.keyDown(qty0, { key: 'ArrowDown' });
    expect(notPrevented).toBe(true);
    expect(document.activeElement).toBe(qty0);
    document.documentElement.removeAttribute('data-awj-ui');
  });
});

describe('WorkspaceTabs', () => {
  const tabs = [
    { id: 'items', label: 'البنود', content: <p>items-panel</p> },
    { id: 'entries', label: 'القيد', content: <p>entries-panel</p>, hidden: true },
    { id: 'doc', label: 'المستند', content: <p>doc-panel</p>, keepMounted: true },
  ];
  const renderTabs = (value: string, onChange = vi.fn()) =>
    render(
      <NextIntlClientProvider locale="ar" messages={messages}>
        <WorkspaceTabs tabs={tabs} value={value} onChange={onChange} />
      </NextIntlClientProvider>
    );

  it('hidden tabs are absent (not disabled); only the active panel is visible', () => {
    renderTabs('items');
    expect(screen.queryByRole('tab', { name: 'القيد' })).toBeNull();
    expect(screen.getByText('items-panel')).toBeTruthy();
    expect(screen.queryByText('entries-panel')).toBeNull();
  });

  it('keepMounted panels stay in the DOM (print/PDF root) but hidden on screen', () => {
    renderTabs('items');
    const doc = screen.getByText('doc-panel').closest('[role="tabpanel"]') as HTMLElement;
    expect(doc.hasAttribute('hidden')).toBe(false);
    expect(doc.className).toContain('hidden');
    expect(doc.className).toContain('print:block');
  });

  it('selecting a tab reports its id', () => {
    const onChange = vi.fn();
    renderTabs('items', onChange);
    fireEvent.click(screen.getByRole('tab', { name: 'المستند' }));
    expect(onChange).toHaveBeenCalledWith('doc');
  });
});
