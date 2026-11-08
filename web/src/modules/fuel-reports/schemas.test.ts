import { describe, expect, it } from 'vitest';
import { loadAll, MAX_OPTION_PAGES } from './use-options';
import { payload } from './__fixtures__';
import { catalogSchema, payloadSchema } from './schemas';

describe('عقد حمولة التقارير', () => {
  it('يقبل الحمولة الصحيحة كاملة', () => {
    expect(payloadSchema.safeParse({ data: payload() }).success).toBe(true);
  });

  it('يُطبِّع المصفوفة الفارغة التي يرمّزها PHP بدل الكائن (مرشحات/صفوف بلا أعمدة)', () => {
    const wire = JSON.parse(JSON.stringify({ data: payload({ filters: {} }) }));
    wire.data.filters = [];
    wire.data.tables[0].rows[0] = [];
    wire.data.tables[0].totals = [];
    const parsed = payloadSchema.parse(wire);
    expect(parsed.data.filters).toEqual({});
    expect(parsed.data.tables[0].rows[0]).toEqual({});
    expect(parsed.data.tables[0].totals).toEqual({});
  });

  it('يرفض كاملةً أي حمولة تخالف العقد (نوع عمود مجهول، مفتاح ناقص، رقم نصي)', () => {
    const bad = (mutate: (d: ReturnType<typeof payload>) => void) => {
      const wire = JSON.parse(JSON.stringify({ data: payload() }));
      mutate(wire.data);
      return payloadSchema.safeParse(wire).success;
    };
    expect(bad((d) => { d.tables[0].columns[0].type = 'html' as never; })).toBe(false);
    expect(bad((d) => { delete (d as Partial<typeof d>).timezone; })).toBe(false);
    expect(bad((d) => { d.summary[0].value = {} as never; })).toBe(false);
    expect(bad((d) => { d.data_quality.complete = 'yes' as never; })).toBe(false);
  });

  it('الكتالوج: عائلات وتقارير بعنوانين ومرشحات', () => {
    const ok = catalogSchema.safeParse({ data: { families: { sales: { ar: 'المبيعات', en: 'Sales' } }, reports: [payload().report] } });
    expect(ok.success).toBe(true);
    expect(catalogSchema.safeParse({ data: { families: {}, reports: [{ key: 'x' }] } }).success).toBe(false);
  });
});

describe('قوائم المرشحات المرقَّمة', () => {
  it('تجلب كل الصفحات (الورديات الأقدم من 50 لا تختفي) حتى السقف', async () => {
    const calls: string[] = [];
    const rows = await loadAll('/fuel-stations/shifts?station_id=s1', async (url) => {
      calls.push(url);
      const page = Number(new URL(`http://x${url}`).searchParams.get('page') ?? 1);
      return { data: [{ id: `r${page}` }], meta: { last_page: 3 } };
    });
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(calls).toEqual(['/fuel-stations/shifts?station_id=s1', '/fuel-stations/shifts?station_id=s1&page=2', '/fuel-stations/shifts?station_id=s1&page=3']);
  });

  it('بلا ترقيم ⇒ طلب واحد، والسقف يحمي من آلاف الصفحات', async () => {
    let n = 0;
    await loadAll('/fuel-stations/stations', async () => { n += 1; return { data: [{ id: 'a' }] }; });
    expect(n).toBe(1);
    n = 0;
    await loadAll('/x', async () => { n += 1; return { data: [], meta: { last_page: 999 } }; });
    expect(n).toBe(MAX_OPTION_PAGES);
  });
});
