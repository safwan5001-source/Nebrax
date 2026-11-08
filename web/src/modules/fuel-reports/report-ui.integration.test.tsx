// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

const calls: string[] = [];
const downloads: string[] = [];
let handler: (url: string) => unknown = () => ({});

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (url: string) => { calls.push(url); return handler(url); }),
  downloadFile: vi.fn(async (url: string) => { downloads.push(url); return 'downloaded'; }),
  fetchPrivateFileUrl: vi.fn(async () => 'blob:none'),
}));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'شركة أَوْج', vat_number: '300000000000003', cr_number: null, logo: null }) }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ name: 'مدير' }) }));

import { ApiError } from '@/lib/api';
import { payload, definition } from './__fixtures__';
import { ReportCenter } from './report-center';
import { ReportViewer } from './report-viewer';

const catalog = (extra: Array<ReturnType<typeof definition>> = []) => ({
  data: {
    families: { sales: { ar: 'المبيعات', en: 'Sales' }, shifts: { ar: 'الورديات', en: 'Shifts' } },
    reports: [definition(), definition({ key: 'sales.by_product', title: { ar: 'المبيعات حسب المنتج', en: 'Sales by product' }, filters: ['station_id', 'from', 'to'] }), definition({ key: 'shifts.log', family: 'shifts', title: { ar: 'سجل الورديات', en: 'Shift log' }, description: { ar: 'كل الورديات', en: 'All shifts' } }), ...extra],
  },
});

const wrap = (ui: React.ReactElement, locale: 'ar' | 'en' = 'ar') => render(<NextIntlClientProvider locale={locale} messages={{ fuelReports: (locale === 'ar' ? ar : en).fuelReports } as never}>{ui}</NextIntlClientProvider>);

beforeEach(() => {
  calls.length = 0;
  downloads.length = 0;
  handler = (url) => {
    if (url.endsWith('/catalog')) return catalog();
    if (url.startsWith('/fuel-stations/stations')) return { data: [{ id: 's1', name: 'محطة الدمام' }] };
    if (url.startsWith('/fuel-stations/products')) return { data: [] };
    if (url.startsWith('/fuel-stations/report-center/sales.daily')) return { data: payload() };
    return { data: [] };
  };
});
afterEach(() => cleanup());

describe('مركز التقارير', () => {
  it('يعرض الكتالوج مجمَّعاً بالعائلات والروابط داخل مسار التطبيق فقط', async () => {
    wrap(<ReportCenter basePath="/fuel-stations/ops/reports" />);
    expect(await screen.findByText('المبيعات حسب المنتج')).toBeTruthy();
    expect(document.querySelectorAll('[data-report-family]').length).toBe(2);
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-report-link]')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/fuel-stations/ops/reports/sales.daily', '/fuel-stations/ops/reports/sales.by_product', '/fuel-stations/ops/reports/shifts.log']);
    expect(links.every((href) => href?.startsWith('/fuel-stations/ops/'))).toBe(true); // لا تحويل إلى أَوْج
  });

  it('البحث يصفّي العناوين والأوصاف، وغياب النتائج برسالة', async () => {
    wrap(<ReportCenter basePath="/fuel-stations/reports" />);
    await screen.findByText('سجل الورديات');
    fireEvent.change(screen.getByLabelText('بحث في التقارير'), { target: { value: 'منتج' } });
    expect(screen.queryByText('سجل الورديات')).toBeNull();
    expect(screen.getByText('المبيعات حسب المنتج')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('بحث في التقارير'), { target: { value: 'zzz' } });
    expect(screen.getByText('لا توجد تقارير مطابقة.')).toBeTruthy();
  });

  it('403 يعرض رسالة عدم الصلاحية بلا زر إعادة محاولة', async () => {
    handler = () => { throw new ApiError(403, 'forbidden', {}); };
    wrap(<ReportCenter basePath="/x" />);
    await waitFor(() => expect(document.querySelector('[data-report-center-error="403"]')).not.toBeNull());
    expect(screen.queryByText('إعادة المحاولة')).toBeNull();
  });
});

describe('عارض التقرير', () => {
  it('يعرض أرقام الخادم كما هي: لترات بثلاث منازل وريال بمنزلتين وصف الإجمالي', async () => {
    wrap(<ReportViewer reportKey="sales.daily" defaultStationId="s1" />);
    const table = await waitFor(() => { const t = document.querySelector('[data-report-table="daily"]'); expect(t).not.toBeNull(); return t as HTMLElement; });
    expect(within(table).getAllByText('100.000').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('230.00').length).toBeGreaterThan(0);
    expect(within(table).getByText('150.000')).toBeTruthy(); // إجمالي اللترات
    expect(within(table).getByText('345.00')).toBeTruthy();  // إجمالي القيمة
    expect(within(table).getByText('الإجمالي')).toBeTruthy();
    // المحطة المختارة في التطبيق تُرسَل مرشحاً (والخادم يتحقق من نطاقها).
    expect(calls.some((c) => c.startsWith('/fuel-stations/report-center/sales.daily') && c.includes('station_id=s1'))).toBe(true);
  });

  it('يملأ الفترة الافتراضية من الخادم ويطبّق المرشحات عند الضغط على «تطبيق»', async () => {
    wrap(<ReportViewer reportKey="sales.daily" />);
    await waitFor(() => expect(document.querySelector('[data-report-ready]')).not.toBeNull());
    expect((document.querySelector('[data-filter="from"]') as HTMLInputElement).value).toBe('2027-03-10');
    fireEvent.change(document.querySelector('[data-filter="to"]') as HTMLInputElement, { target: { value: '2027-03-12' } });
    fireEvent.click(document.querySelector('[data-apply]') as HTMLButtonElement);
    await waitFor(() => expect(calls.some((c) => c.includes('to=2027-03-12') && c.includes('from=2027-03-10'))).toBe(true));
  });

  it('مدى معكوس يُمنع محلياً قبل أي طلب', async () => {
    wrap(<ReportViewer reportKey="sales.daily" />);
    await waitFor(() => expect(document.querySelector('[data-report-ready]')).not.toBeNull());
    const before = calls.length;
    fireEvent.change(document.querySelector('[data-filter="from"]') as HTMLInputElement, { target: { value: '2027-04-01' } });
    expect(screen.getByText('تاريخ البداية بعد تاريخ النهاية.')).toBeTruthy();
    expect((document.querySelector('[data-apply]') as HTMLButtonElement).disabled).toBe(true);
    expect(calls.length).toBe(before);
  });

  it('بيانات ناقصة: شارة عدم الاكتمال مع الفجوة المترجمة، ولا إجمالي جزئي', async () => {
    handler = (url) => {
      if (url.endsWith('/catalog')) return catalog();
      if (url.startsWith('/fuel-stations/report-center/')) {
        const base = payload();
        const table = { ...base.tables[0], rows: [{ ...base.tables[0].rows[0], amount: null }], totals: { shifts: 1, liters: 100000, amount: null } };
        return { data: { ...base, tables: [table], data_quality: { complete: false, gaps: ['missing_reading'], notes: [] } } };
      }
      return { data: [] };
    };
    wrap(<ReportViewer reportKey="sales.daily" />);
    await waitFor(() => expect(document.querySelector('[data-data-quality="incomplete"]')).not.toBeNull());
    expect(screen.getByText(/قراءة عداد ناقصة/)).toBeTruthy();
    const table = document.querySelector('[data-report-table="daily"]') as HTMLElement;
    expect(within(table).queryByText('0.00')).toBeNull(); // الغائب «—» لا صفر
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(2); // خلية المبلغ وإجماليه
  });

  it.each([[403, 'forbidden', 'ليست لديك صلاحية لعرض هذا التقرير.'], [500, 'failed', 'تعذّر تحميل التقرير. حاول مجدداً.']])('خطأ %i ⇒ رسالة صريحة', async (status, _k, message) => {
    handler = (url) => {
      if (url.endsWith('/catalog')) return catalog();
      if (url.startsWith('/fuel-stations/report-center/')) throw new ApiError(status, 'x', {});
      return { data: [] };
    };
    wrap(<ReportViewer reportKey="sales.daily" />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText('إعادة المحاولة') !== null).toBe(status === 500);
  });

  it('استجابة تخالف العقد تُرفض كاملة برسالة صريحة (لا عرض جزئي)', async () => {
    handler = (url) => (url.endsWith('/catalog') ? catalog() : url.startsWith('/fuel-stations/report-center/') ? { data: { nonsense: true } } : { data: [] });
    wrap(<ReportViewer reportKey="sales.daily" />);
    expect(await screen.findByText('استجابة غير متوقعة من الخادم.')).toBeTruthy();
    expect(document.querySelector('[data-report-table]')).toBeNull();
  });

  it('تقرير لا يملكه المستخدم (غائب عن كتاباوغه) ⇒ غير متاح', async () => {
    wrap(<ReportViewer reportKey="finance.secret" />);
    expect(await screen.findByText('التقرير غير متاح لك أو غير موجود.')).toBeTruthy();
  });

  it('تقرير الوردية التفصيلي لا يُجلب قبل اختيار وردية', async () => {
    handler = (url) => (url.endsWith('/catalog') ? catalog([definition({ key: 'shifts.detail', family: 'shifts', filters: ['shift_id'] })]) : { data: [{ id: 'sh1', number: 'SH-1', opened_at: '2027-03-10T09:00:00Z' }] });
    wrap(<ReportViewer reportKey="shifts.detail" />);
    expect(await screen.findByText(/اختر وردية ثم اضغط/)).toBeTruthy();
    expect(calls.some((c) => c.startsWith('/fuel-stations/report-center/shifts.detail'))).toBe(false);
  });
});

describe('الإجراءات', () => {
  it('Excel يطلب مسار التصدير نفسه بالمرشحات واللغة، ويمنع الضغط المزدوج', async () => {
    wrap(<ReportViewer reportKey="sales.daily" defaultStationId="s1" />);
    const button = await waitFor(() => { const b = document.querySelector('[data-report-action="xlsx"]'); expect(b).not.toBeNull(); return b as HTMLButtonElement; });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(downloads.length).toBe(1));
    expect(downloads[0]).toContain('/fuel-stations/report-center/sales.daily/export');
    expect(downloads[0]).toContain('format=xlsx');
    expect(downloads[0]).toContain('lang=ar');
    expect(downloads[0]).toContain('station_id=s1');
    await waitFor(() => expect(document.querySelector('[data-report-notice="ok"]')).not.toBeNull());
  });

  it('أحجام الورق الحرارية لا تظهر إلا للتقارير الحرارية', async () => {
    wrap(<ReportViewer reportKey="sales.daily" />);
    await waitFor(() => expect(document.querySelector('[data-report-actions]')).not.toBeNull());
    expect(document.querySelector('[data-paper]')).toBeNull();
    cleanup();
    handler = (url) => {
      if (url.endsWith('/catalog')) return { data: { families: { shifts: { ar: 'الورديات', en: 'Shifts' } }, reports: [definition({ key: 'shifts.closing', family: 'shifts', thermal: true, filters: ['station_id', 'from', 'to'] })] } };
      if (url.startsWith('/fuel-stations/report-center/')) return { data: payload({ report: definition({ key: 'shifts.closing', family: 'shifts', thermal: true }) }) };
      return { data: [] };
    };
    wrap(<ReportViewer reportKey="shifts.closing" />);
    await waitFor(() => expect(document.querySelectorAll('[data-paper]').length).toBe(3));
  });

  it('الواجهة الإنجليزية LTR بنفس الأرقام', async () => {
    wrap(<ReportViewer reportKey="sales.daily" />, 'en');
    const table = await waitFor(() => { const t = document.querySelector('[data-report-table="daily"]'); expect(t).not.toBeNull(); return t as HTMLElement; });
    expect(within(table).getByText('Total')).toBeTruthy();
    expect(within(table).getByText('150.000')).toBeTruthy();
  });
});
