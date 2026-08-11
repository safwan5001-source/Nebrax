import { describe, expect, it } from 'vitest';
import {
  barPercent,
  dailySeries,
  expenseTone,
  groupTop,
  netIncome,
  toNumber,
} from '../dashboard';

/**
 * حسابات لوحة التحكم. أهمّها `netIncome`: بطاقة «الأداء المالي» تعرض المبيعات
 * والصافي معاً، فلو اختلف حسابُهما لقرأ المستخدم رقمين متناقضين في بطاقة واحدة.
 */
describe('toNumber', () => {
  it('يقرأ نصوص الـ API بفواصلها', () => {
    expect(toNumber('52,968.44')).toBe(52968.44);
    expect(toNumber('0.00')).toBe(0);
    expect(toNumber(1234.5)).toBe(1234.5);
  });

  it('الغياب والتلف يعودان صفراً لا NaN — وإلا انتشر NaN في كل مشتقّ', () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('')).toBe(0);
    expect(toNumber('غير رقم')).toBe(0);
  });
});

describe('netIncome', () => {
  it('يحسب الفرق حين لا يرسله الخادم', () => {
    expect(netIncome('96.73', '49.50')).toBeCloseTo(47.23, 2);
  });

  it('**يفضّل قيمة الخادم** — هو مصدر الحقيقة المحاسبي', () => {
    // لو أرسل الخادم صافياً مختلفاً (مصروفات مقابلة، حسابات مستبعَدة…) فهو الأصحّ
    expect(netIncome('100', '40', '55')).toBe(55);
  });

  it('يقبل الصافي السالب — الخسارة رقمٌ صحيح لا حالة خطأ', () => {
    expect(netIncome('40', '100')).toBe(-60);
  });

  it('صفر الخادم قيمةٌ لا غياب', () => {
    expect(netIncome('100', '40', '0')).toBe(0);
  });
});

describe('barPercent', () => {
  it('المرجع هو الأكبر بين الطرفين', () => {
    expect(barPercent(100, 100)).toBe(100);
    expect(barPercent(50, 100)).toBe(50);
  });

  it('لا يفيض خارج الإطار ولا ينزل تحت الصفر', () => {
    expect(barPercent(200, 100)).toBe(100);
    expect(barPercent(-5, 100)).toBe(0);
  });

  it('مرجعٌ صفري لا يقسم على صفر', () => {
    expect(barPercent(0, 0)).toBe(0);
  });
});

describe('expenseTone', () => {
  it('أحمر متى وُجد مصروف فعلي', () => {
    expect(expenseTone(49.5)).toBe('negative');
  });

  it('وصفرٌ محايد — لا شريط أحمر بلا مصروف', () => {
    expect(expenseTone(0)).toBe('neutral');
  });
});

describe('dailySeries', () => {
  it('ينتهي عند أحدث تاريخ في البيانات لا عند اليوم', () => {
    const series = dailySeries([
      { date: '2026-01-01', amount: 10 },
      { date: '2026-01-03', amount: 30 },
    ], 3);

    // النافذة 01→03: [10, 0, 30]
    expect(series).toEqual([10, 0, 30]);
  });

  it('يجمع عدّة صفوف في اليوم نفسه', () => {
    expect(dailySeries([
      { date: '2026-01-02', amount: 5 },
      { date: '2026-01-02', amount: 7 },
    ], 2)).toEqual([0, 12]);
  });

  it('يتجاهل ما خرج عن النافذة بدل أن يزحزحها', () => {
    const series = dailySeries([
      { date: '2026-01-01', amount: 999 },
      { date: '2026-01-05', amount: 5 },
    ], 2);

    expect(series).toEqual([0, 5]);
  });

  it('بلا بيانات يعيد أصفاراً بالطول المطلوب — لا مصفوفة فارغة تكسر الرسم', () => {
    expect(dailySeries([], 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('**يتخطّى التاريخ التالف وحده** لا السلسلة كلّها', () => {
    // `Math.max` مع `NaN` يعطي `NaN` — فصفٌّ تالف واحد كان يُفرغ السلسلة.
    expect(dailySeries([
      { date: 'ليس تاريخاً', amount: 9 },
      { date: '2026-01-02', amount: 4 },
    ], 2)).toEqual([0, 4]);
  });

  it('كل التواريخ تالفة ⇒ أصفار لا انهيار', () => {
    expect(dailySeries([{ date: 'س', amount: 1 }], 3)).toEqual([0, 0, 0]);
  });
});

describe('groupTop', () => {
  const rows = [
    { name: 'إسمنت', total: 300 },
    { name: 'حديد', total: 900 },
    { name: 'إسمنت', total: 200 },
    { name: null, total: 999 },
  ];

  it('يجمع بالمفتاح ويرتّب تنازلياً', () => {
    expect(groupTop(rows, (r) => r.name, (r) => r.total)).toEqual([
      { key: 'حديد', amount: 900 },
      { key: 'إسمنت', amount: 500 },
    ]);
  });

  it('**يُسقط ما لا مفتاح له** — لا مجموعة «فارغ» تُشوّش الرسم', () => {
    const result = groupTop(rows, (r) => r.name, (r) => r.total);
    expect(result.some((g) => g.amount === 999)).toBe(false);
  });

  it('يقصّ عند الحدّ فيبقى الرسم مقروءاً', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `ص${i}`, total: i }));
    expect(groupTop(many, (r) => r.name, (r) => r.total, 5)).toHaveLength(5);
  });
});
