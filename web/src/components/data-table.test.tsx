/* @vitest-environment jsdom */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from './data-table';
import { TEST_LOCALES, nebraxText, renderIntl } from '@/test-utils/intl';

afterEach(cleanup);

interface Row {
  id: string;
  number: string;
  partner: string;
  total: string;
  remaining: string;
  status: string;
  date: string;
}

const rows: Row[] = [
  { id: '1', number: 'INV-1001', partner: 'مؤسسة الطموح', total: '1,150.00', remaining: '150.00', status: 'مرحّلة', date: '2026-08-01' },
];

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'number', header: 'الرقم' },
  { accessorKey: 'partner', header: 'العميل' },
  { accessorKey: 'total', header: 'الإجمالي' },
  { accessorKey: 'status', header: 'الحالة' },
];

/** قائمة الجوال هي `ul` الوحيدة داخل الجدول. */
function mobileList() {
  return screen.getByRole('list');
}

describe('DataTable mobile record hierarchy', () => {
  it('renders the desktop table and a mobile list from the same rows', () => {
    renderIntl(<DataTable columns={columns} data={rows} showToolbar={false} />);

    expect(screen.getByRole('table')).toBeTruthy();
    expect(within(mobileList()).getAllByRole('listitem')).toHaveLength(1);
  });

  it('falls back to labelled cells when no mobile hierarchy is declared', () => {
    renderIntl(<DataTable columns={columns} data={rows} showToolbar={false} />);

    const record = within(mobileList()).getAllByRole('listitem')[0];
    // السلوك القديم: كل عمود يظهر بتسميته — تبقى الشاشات غير المهاجَرة كما هي.
    for (const header of ['الرقم', 'العميل', 'الإجمالي', 'الحالة']) {
      expect(within(record).getByText(header)).toBeTruthy();
    }
  });

  it('replaces the labelled cells with an ordered record when a hierarchy is declared', () => {
    renderIntl(
      <DataTable
        columns={columns}
        data={rows}
        showToolbar={false}
        mobileRecord={(row) => ({
          title: row.number,
          subtitle: row.partner,
          amountLabel: 'الإجمالي',
          amount: row.total,
          secondary: { label: 'المتبقي', value: row.remaining },
          status: <span>{row.status}</span>,
          meta: row.date,
          actions: <button type="button">عرض</button>,
        })}
      />
    );

    const record = within(mobileList()).getAllByRole('listitem')[0];

    // المعرّف والطرف المقابل والمبلغ والحالة والتاريخ والإجراء — كلها حاضرة…
    for (const value of ['INV-1001', 'مؤسسة الطموح', '1,150.00', '150.00', 'مرحّلة', '2026-08-01']) {
      expect(within(record).getByText(value)).toBeTruthy();
    }
    expect(within(record).getByRole('button', { name: 'عرض' })).toBeTruthy();

    // …ولا تُكرَّر رؤوس الأعمدة كتسميات، فالترتيب هو ما يحمل المعنى لا التسمية.
    expect(within(record).queryByText('العميل')).toBeNull();
    expect(within(record).queryByText('الحالة')).toBeNull();
  });

  it('orders the record by importance: identifier, counterpart, then metric', () => {
    renderIntl(
      <DataTable
        columns={columns}
        data={rows}
        showToolbar={false}
        mobileRecord={(row) => ({ title: row.number, subtitle: row.partner, amount: row.total })}
      />
    );

    const record = within(mobileList()).getAllByRole('listitem')[0];
    const text = record.textContent ?? '';
    expect(text.indexOf('INV-1001')).toBeLessThan(text.indexOf('مؤسسة الطموح'));
    expect(text.indexOf('مؤسسة الطموح')).toBeLessThan(text.indexOf('1,150.00'));
  });
});

describe('DataTable screen states', () => {
  it('shows a busy state instead of an empty table while loading', () => {
    renderIntl(<DataTable columns={columns} data={[]} loading showToolbar={false} />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the caller-supplied empty message when there are no rows', () => {
    renderIntl(<DataTable columns={columns} data={[]} emptyLabel="No invoices" showToolbar={false} />);

    expect(screen.getByText('No invoices')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a load failure with a retry instead of a misleading empty list', async () => {
    const onRetry = vi.fn();
    renderIntl(<DataTable columns={columns} data={[]} error="Could not load invoices" onRetry={onRetry} showToolbar={false} />);

    expect(screen.getByRole('alert').textContent).toBe('Could not load invoices');
    expect(screen.queryByRole('table')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: nebraxText('ar', 'retry') }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('prefers the error state over stale rows', () => {
    renderIntl(<DataTable columns={columns} data={rows} error="Could not refresh" showToolbar={false} />);
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe.each(TEST_LOCALES)('DataTable default labels (%s)', (locale) => {
  it('falls back to a translated empty message when the page supplies none', () => {
    renderIntl(<DataTable columns={columns} data={[]} showToolbar={false} />, locale);
    expect(screen.getByText(nebraxText(locale, 'noResults'))).toBeTruthy();
  });

  it('names the CSV export in the active language', () => {
    renderIntl(<DataTable columns={columns} data={rows} exportName="invoices" />, locale);
    expect(screen.getByTitle(nebraxText(locale, 'exportCsv'))).toBeTruthy();
  });

  it('offers a translated retry on a load failure', () => {
    renderIntl(<DataTable columns={columns} data={[]} error="x" onRetry={() => {}} showToolbar={false} />, locale);
    expect(screen.getByRole('button', { name: nebraxText(locale, 'retry') })).toBeTruthy();
  });
});

describe('DataTable label language', () => {
  it('leaves no Arabic default in an English interface', () => {
    const { container, unmount } = renderIntl(<DataTable columns={columns} data={[]} exportName="invoices" />, 'en');

    expect(screen.getByText('No results')).toBeTruthy();
    expect(screen.getByTitle('Export CSV')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[\u0600-\u06FF]/);
    unmount();

    renderIntl(<DataTable columns={columns} data={[]} error="Could not load" onRetry={() => {}} showToolbar={false} />, 'en');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps the Arabic defaults in an Arabic interface', () => {
    const { unmount } = renderIntl(<DataTable columns={columns} data={[]} exportName="invoices" />, 'ar');

    expect(screen.getByText('لا توجد نتائج')).toBeTruthy();
    expect(screen.getByTitle('تصدير CSV')).toBeTruthy();
    unmount();

    renderIntl(<DataTable columns={columns} data={[]} error="تعذّر التحميل" onRetry={() => {}} showToolbar={false} />, 'ar');
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
  });
});

/**
 * الفرز الخادميّ وتحديد الصفوف — إضافتان اختياريتان، فما لا يمرّرهما يبقى
 * على سلوكه القديم حرفياً (تحرسه المجموعات أعلاه).
 */
const sortRows: Row[] = [
  { id: '1', number: 'INV-1001', partner: 'باء', total: '20.00', remaining: '0.00', status: 'مرحّلة', date: '2026-08-01' },
  { id: '2', number: 'INV-1002', partner: 'ألف', total: '10.00', remaining: '0.00', status: 'مسودة', date: '2026-08-02' },
];

function firstBodyCell(): string {
  return within(screen.getByRole('table')).getAllByRole('cell')[0].textContent ?? '';
}

describe('DataTable client sorting (unchanged default)', () => {
  it('sorts the loaded rows locally when no server sort is supplied', async () => {
    renderIntl(<DataTable columns={columns} data={sortRows} showToolbar={false} />);

    expect(firstBodyCell()).toBe('INV-1001');
    await userEvent.click(screen.getByRole('button', { name: 'العميل' }));
    expect(firstBodyCell()).toBe('INV-1002');
  });

  it('adds no selection column unless one is requested', () => {
    renderIntl(<DataTable columns={columns} data={sortRows} showToolbar={false} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('DataTable server sorting', () => {
  it('lifts the sort to the caller and never reorders the page itself', async () => {
    const onChange = vi.fn();
    renderIntl(
      <DataTable
        columns={columns}
        data={sortRows}
        showToolbar={false}
        serverSort={{ value: 'number', onChange, columns: ['number', 'partner'] }}
      />
    );

    expect(firstBodyCell()).toBe('INV-1001');
    await userEvent.click(screen.getByRole('button', { name: 'الرقم' }));

    expect(onChange).toHaveBeenCalledWith('-number');
    // الصفوف كما وردت من الخادم؛ الترتيب لا يتغيّر في المتصفح.
    expect(firstBodyCell()).toBe('INV-1001');
  });

  it('starts a newly picked column ascending', async () => {
    const onChange = vi.fn();
    renderIntl(
      <DataTable
        columns={columns}
        data={sortRows}
        showToolbar={false}
        serverSort={{ value: 'number', onChange, columns: ['number', 'partner'] }}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'العميل' }));
    expect(onChange).toHaveBeenCalledWith('partner');
  });

  it('offers no header sort for a column the server cannot sort', () => {
    renderIntl(
      <DataTable
        columns={columns}
        data={sortRows}
        showToolbar={false}
        serverSort={{ value: 'number', onChange: vi.fn(), columns: ['number'] }}
      />
    );

    expect(screen.getByRole('button', { name: 'الرقم' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'العميل' })).toBeNull();
  });

  it('reflects the server direction in aria-sort', () => {
    renderIntl(
      <DataTable
        columns={columns}
        data={sortRows}
        showToolbar={false}
        serverSort={{ value: '-partner', onChange: vi.fn(), columns: ['number', 'partner'] }}
      />
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0].getAttribute('aria-sort')).toBe('none');
    expect(headers[1].getAttribute('aria-sort')).toBe('descending');
  });
});

describe('DataTable row selection', () => {
  it('returns the checked row id to the caller', async () => {
    const onChange = vi.fn();
    renderIntl(
      <DataTable
        columns={columns}
        data={sortRows}
        showToolbar={false}
        selection={{ selectedIds: [], onChange, getRowId: (row) => row.id }}
      />
    );

    await userEvent.click(within(screen.getByRole('table')).getAllByRole('checkbox')[1]);
    expect(onChange).toHaveBeenCalledWith(['1']);
  });

  it('selects and clears every visible row from the header checkbox', async () => {
    const onChange = vi.fn();
    const { rerender } = renderIntl(
      <DataTable
        columns={columns}
        data={sortRows}
        showToolbar={false}
        selection={{ selectedIds: [], onChange, getRowId: (row) => row.id }}
      />
    );

    await userEvent.click(screen.getByRole('checkbox', { name: nebraxText('ar', 'selectAllRows') }));
    expect(onChange).toHaveBeenCalledWith(['1', '2']);

    rerender(
      <DataTable
        columns={columns}
        data={sortRows}
        showToolbar={false}
        selection={{ selectedIds: ['1', '2'], onChange, getRowId: (row) => row.id }}
      />
    );
    await userEvent.click(screen.getByRole('checkbox', { name: nebraxText('ar', 'selectAllRows') }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('shows the same selection in the table and in the mobile record', () => {
    const { container } = renderIntl(
      <DataTable
        columns={columns}
        data={sortRows}
        showToolbar={false}
        mobileRecord={(row) => ({ title: row.number })}
        selection={{ selectedIds: ['2'], onChange: vi.fn(), getRowId: (row) => row.id }}
      />
    );

    const checked = Array.from(
      container.querySelectorAll<HTMLInputElement>(`input[aria-label="${nebraxText('ar', 'selectRow')}"]`)
    ).filter((box) => box.checked);
    // صفٌّ واحد محدَّد، ظاهرٌ مرّتين: صفّ الجدول وبطاقة الجوال.
    expect(checked).toHaveLength(2);
  });

  it('leaves no Arabic default in an English interface for the selection controls', () => {
    const { container } = renderIntl(
      <DataTable
        columns={[{ accessorKey: 'number', header: 'Number' }]}
        data={[{ ...sortRows[0], partner: 'Acme', status: 'Posted' }]}
        showToolbar={false}
        mobileRecord={(row) => ({ title: row.number })}
        selection={{ selectedIds: [], onChange: vi.fn(), getRowId: (row) => row.id }}
      />,
      'en'
    );

    expect(screen.getByRole('checkbox', { name: 'Select all visible rows' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/[؀-ۿ]/);
  });
});
