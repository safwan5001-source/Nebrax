import React from 'react';
import { SANS, Theme } from '../config/theme';
import { SALE } from '../config/demo-data';
import { Abs, Amount, Badge, Card, Mono } from './common';
import { Sidebar, TopBar } from './Dashboard';

/** Invoice register (DataTable grammar: dense rows, mono numbers, status badges). */
export const InvoicesPanel: React.FC<{ t: Theme }> = ({ t }) => {
  const rows: Array<[string, string, string, number, string]> = [
    [SALE.invoice, 'عميل نقدي', SALE.date, 125000, 'مدفوعة'],
    ['INV-2026-00417', 'مؤسسة الواحة للتجارة', SALE.date, 483000, 'جزئية'],
    ['INV-2026-00416', 'شركة الساحل للنقل', SALE.date, 1245000, 'مدفوعة'],
    ['INV-2026-00415', 'عميل نقدي', '2026-09-28', 18500, 'مدفوعة'],
    ['INV-2026-00414', 'مؤسسة الأفق للمقاولات', '2026-09-28', 276000, 'غير مدفوعة'],
    ['INV-2026-00413', 'عميل نقدي', '2026-09-28', 9200, 'مدفوعة'],
    ['INV-2026-00412', 'شركة البحر الأحمر للخدمات', '2026-09-27', 3120000, 'مدفوعة'],
    ['INV-2026-00411', 'عميل نقدي', '2026-09-27', 42500, 'مدفوعة'],
    ['INV-2026-00410', 'مؤسسة النخبة للصيانة', '2026-09-27', 1567500, 'جزئية'],
    ['INV-2026-00409', 'عميل نقدي', '2026-09-27', 187500, 'مدفوعة'],
  ];
  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, background: t.bg, fontFamily: SANS, color: t.text }}>
      <Sidebar t={t} active="الفواتير" />
      <TopBar t={t} />
      <Abs x={24} y={84} w={1624} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 34, fontWeight: 700 }}>الفواتير</span>
        <span style={{ background: t.primary, color: t.bg === '#0E1014' ? '#0E1014' : '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 15, fontWeight: 600 }}>فاتورة جديدة</span>
      </Abs>
      <Card t={t} x={24} y={170} w={1624} h={886} r={8}>
        <div style={{ height: 52, background: t.bg, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', padding: '0 28px', fontSize: 14, fontWeight: 600, color: t.muted, gap: 0 }}>
          <span style={{ width: 300 }}>الرقم</span>
          <span style={{ width: 460 }}>العميل</span>
          <span style={{ width: 260 }}>التاريخ</span>
          <span style={{ width: 260 }}>الحالة</span>
          <span style={{ flex: 1, textAlign: 'left' }}>الإجمالي</span>
        </div>
        {rows.map(([no, who, date, v, st], i) => (
          <div key={no} style={{ height: 76, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', padding: '0 28px', fontSize: 17, background: i === 0 ? t.primarySoft : undefined }}>
            <span style={{ width: 300 }}>
              <Mono size={16} color={i === 0 ? t.primary : t.text} weight={600}>
                {no}
              </Mono>
            </span>
            <span style={{ width: 460 }}>{who}</span>
            <span style={{ width: 260 }}>
              <Mono size={15} color={t.muted}>{date}</Mono>
            </span>
            <span style={{ width: 260 }}>
              <Badge t={t} tone={st === 'مدفوعة' ? 'positive' : 'muted'} size={13}>
                {st}
              </Badge>
            </span>
            <span style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
              <Amount v={v} size={17} weight={600} color={t.text} />
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
};

/** Commerce storefront (store-experience grammar: product cards with price + stock). */
export const StorePanel: React.FC<{ t: Theme }> = ({ t }) => {
  const items: Array<[string, number, string]> = [
    [SALE.product, 31250, 'متوفر'],
    ['فلتر زيت أصلي', 4500, 'متوفر'],
    ['بطارية 70 أمبير', 42000, 'كمية محدودة'],
    ['شمعات احتراق (4)', 9600, 'متوفر'],
    ['سائل تبريد المحرك', 5400, 'متوفر'],
    ['ماسحات زجاج أمامية', 5500, 'متوفر'],
    ['زيت ناقل حركة ATF', 4250, 'متوفر'],
    ['فلتر هواء', 6800, 'متوفر'],
  ];
  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, background: t.bg, fontFamily: SANS, color: t.text }}>
      <Abs x={0} y={0} w={1920} h={84} style={{ background: t.surface, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 64px' }}>
        <span style={{ fontSize: 24, fontWeight: 700 }}>{SALE.store}</span>
        <span style={{ display: 'flex', gap: 36, fontSize: 16, color: t.muted }}>
          <span style={{ color: t.primary, fontWeight: 600 }}>المتجر</span>
          <span>الخدمات</span>
          <span>الفروع</span>
          <span>السلة (0)</span>
        </span>
      </Abs>
      <Abs x={64} y={124} w={1792} style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.3 }}>زيوت وقطع أصلية</div>
        <div style={{ fontSize: 18, color: t.muted, marginTop: 6 }}>المخزون متصل مباشرة بنقطة البيع — ما تراه متوفر فعلاً.</div>
      </Abs>
      {items.map(([name, price, stock], i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        return (
          <Card key={name} t={t} x={1856 - (col + 1) * 434 + 16} y={286 + row * 390} w={418} h={370} r={12}>
            <div style={{ height: 210, background: t.bg, borderBottom: `1px solid ${t.border}` }} />
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 19, fontWeight: 600 }}>{name}</div>
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Amount v={price} size={21} weight={700} color={t.text} />
                <span style={{ fontSize: 14, color: stock === 'متوفر' ? t.positive : t.warning }}>{stock}</span>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};
