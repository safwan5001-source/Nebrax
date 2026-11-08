import type { ReportDefinition, ReportPayload } from './schemas';

/** حمولة اصطناعية بشكل ما يعيده `FuelReportEngine` (بيانات اختبار معزولة، لا بيانات محطات حقيقية). */
export const definition = (over: Partial<ReportDefinition> = {}): ReportDefinition => ({
  key: 'sales.daily', family: 'sales', title: { ar: 'المبيعات اليومية', en: 'Daily sales' }, description: { ar: 'وصف', en: 'desc' },
  filters: ['station_id', 'from', 'to', 'product_id', 'status', 'date_basis'], source: 'meter_derived', orientation: 'landscape', thermal: false, ...over,
});

export const payload = (over: Partial<ReportPayload> = {}): ReportPayload => ({
  report: definition(),
  generated_at: '2027-03-11T10:00:00+00:00', timezone: 'Asia/Riyadh', timezones: ['Asia/Riyadh'], tenant: { name: 'شركة اختبار' },
  stations: [{ id: 's1', name: 'محطة الدمام', code: 'D1' }], period: { from: '2027-03-10', to: '2027-03-11' }, filters: {},
  summary: [
    { key: 'shifts', label: { ar: 'عدد الورديات', en: 'Shifts' }, type: 'int', value: 2 },
    { key: 'liters', label: { ar: 'اللترات', en: 'Liters' }, type: 'liters', value: 150000 },
    { key: 'amount', label: { ar: 'قيمة المبيعات', en: 'Sales value' }, type: 'money', value: 34500 },
  ],
  tables: [{
    key: 'daily', title: { ar: 'المبيعات اليومية', en: 'Daily sales' },
    columns: [
      { key: 'period', type: 'date', label: { ar: 'اليوم', en: 'Day' } },
      { key: 'station', type: 'text', label: { ar: 'المحطة', en: 'Station' } },
      { key: 'shifts', type: 'int', label: { ar: 'الورديات', en: 'Shifts' }, total: 'sum' },
      { key: 'liters', type: 'liters', label: { ar: 'اللترات', en: 'Liters' }, total: 'sum' },
      { key: 'amount', type: 'money', label: { ar: 'القيمة', en: 'Value' }, total: 'sum' },
    ],
    rows: [
      { period: '2027-03-10', station: 'محطة الدمام', shifts: 1, liters: 100000, amount: 23000 },
      { period: '2027-03-11', station: 'محطة الدمام', shifts: 1, liters: 50000, amount: 11500 },
    ],
    totals: { shifts: 2, liters: 150000, amount: 34500 },
  }],
  data_quality: { complete: true, gaps: [], notes: [{ ar: 'تقدير تشغيلي', en: 'Operational estimate' }] },
  truncated: false, source: { kind: 'meter_derived' }, ...over,
});
