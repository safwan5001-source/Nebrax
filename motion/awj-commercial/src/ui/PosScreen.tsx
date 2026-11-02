import React from 'react';
import { MONO, SANS, Theme } from '../config/theme';
import { SALE } from '../config/demo-data';
import { Abs, Amount, Badge, Card, Icon, ICONS, Mono, Txt } from './common';
import { Riyal } from '../primitives/Riyal';

/** World anchors (POS world = 1920×1080 at s=1). */
export const POS = {
  cartLine: { x: 344, y: 244 },
  totalLeft: { x: 48, y: 865 },
  tile: { x: 1606, y: 212, w: 290, h: 250 },
  pay: { x: 48, y: 960, w: 592, h: 72 },
};

const PRODUCTS: Array<[string, number, string, number]> = [
  [SALE.product, 31250, '6281100457102', 128],
  ['فلتر زيت أصلي', 4500, '6281100457119', 64],
  ['زيت محرك 10W-40', 18975, '6281100457126', 92],
  ['فلتر هواء', 6800, '6281100457133', 41],
  ['سائل تبريد المحرك', 5400, '6281100457140', 57],
  ['زيت ناقل حركة ATF', 4250, '6281100457157', 36],
  ['بطارية 70 أمبير', 42000, '6281100457164', 12],
  ['شمعات احتراق (4)', 9600, '6281100457171', 48],
  ['سائل فرامل DOT4', 2800, '6281100457188', 73],
  ['ماسحات زجاج أمامية', 5500, '6281100457195', 29],
  ['خدمة تغيير زيت', 3500, '—', 0],
  ['غسيل محرك', 6000, '—', 0],
];

export type PosState = {
  qty: number;
  lineTotal: React.ReactNode;
  subtotal: React.ReactNode;
  vat: React.ReactNode;
  total: React.ReactNode | null;
  tilePress: number; // 0..1 press depth
  tileRing: number; // 0..1 selection ring
  payPress: number;
  payDone: number;
  cartLineIn: number; // 0..1
  payAmount: React.ReactNode;
};

export const PosScreen: React.FC<{ t: Theme; s: PosState }> = ({ t, s }) => {
  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, background: t.bg, fontFamily: SANS, color: t.text }}>
      {/* Top bar */}
      <Abs x={0} y={0} w={1920} h={64} style={{ background: t.surface, borderBottom: `1px solid ${t.border}` }}>
        <Abs x={1650} y={0} w={246} h={64} style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-start', flexDirection: 'row' }}>
          <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 26, color: t.primary, lineHeight: 1 }}>أَوْج</span>
          <span style={{ width: 1, height: 22, background: t.border }} />
          <Txt size={16} weight={600}>نقطة البيع</Txt>
        </Abs>
        <Abs x={1330} y={20} h={24} style={{ display: 'flex', alignItems: 'center' }}>
          <Badge t={t}>الوردية مفتوحة</Badge>
        </Abs>
        <Abs x={24} y={0} h={64} style={{ display: 'flex', alignItems: 'center', gap: 16, direction: 'ltr' }}>
          <span style={{ width: 34, height: 34, borderRadius: 999, background: t.primarySoft, color: t.primary, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 600 }}>س</span>
          <Txt size={14} color={t.muted}>الفرع الرئيسي — الدمام</Txt>
          <Mono size={14} color={t.muted}>{SALE.time}</Mono>
        </Abs>
      </Abs>

      {/* Products */}
      <Card t={t} x={688} y={88} w={1208} h={52} r={8} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px' }}>
        <Icon d={ICONS.search} size={18} color={t.muted} />
        <Txt size={15} color={t.muted}>ابحث بالاسم أو امسح الباركود</Txt>
      </Card>
      <Abs x={688} y={156} w={1208} h={36} style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
        {['الكل', 'زيوت المحركات', 'الفلاتر', 'البطاريات', 'السوائل', 'الخدمات'].map((c, i) => (
          <span
            key={c}
            style={{
              fontSize: 14,
              fontWeight: i === 1 ? 600 : 500,
              padding: '7px 16px',
              borderRadius: 999,
              background: i === 1 ? t.primary : t.surface,
              color: i === 1 ? '#fff' : t.text,
              border: `1px solid ${i === 1 ? t.primary : t.border}`,
              lineHeight: 1.3,
            }}
          >
            {c}
          </span>
        ))}
      </Abs>
      {PRODUCTS.map(([name, price, barcode, stock], i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = 1606 - col * 306;
        const y = 212 + row * 266;
        const hero = i === 0;
        const press = hero ? s.tilePress : 0;
        return (
          <div
            key={name}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 290,
              height: 250,
              transform: `scale(${1 - press * 0.035})`,
              background: t.surface,
              borderRadius: 8,
              border: `1px solid ${hero && s.tileRing > 0 ? t.primary : t.border}`,
              boxShadow: hero ? `0 0 0 ${2 * s.tileRing}px ${t.primary}` : undefined,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ height: 48, background: t.bg, borderBottom: `1px solid ${t.border}` }} />
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.4, minHeight: 45 }}>{name}</span>
              <span style={{ marginTop: 8, display: 'flex' }}>
                <Amount v={price} size={19} weight={700} color={t.text} />
              </span>
              <div style={{ marginTop: 'auto', borderTop: `1px solid ${t.border}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.muted }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Icon d={ICONS.barcode} size={13} color={t.muted} />
                  <Mono size={11} color={t.muted}>{barcode}</Mono>
                </span>
                {stock > 0 && <span>المتوفر {stock}</span>}
              </div>
            </div>
            {hero && s.qty > 0 && (
              <span
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 10,
                  minWidth: 30,
                  height: 30,
                  borderRadius: 999,
                  background: t.primary,
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: MONO,
                  fontWeight: 600,
                  fontSize: 15,
                  opacity: s.tileRing,
                }}
              >
                {s.qty}
              </span>
            )}
          </div>
        );
      })}

      {/* Cart */}
      <Card t={t} x={24} y={88} w={640} h={968} r={8}>
        <Abs x={0} y={0} w={640} h={72} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: `1px solid ${t.border}` }}>
          <Txt size={22} weight={600}>السلة</Txt>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: t.muted, border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 12px' }}>
            <Icon d={ICONS.users} size={16} color={t.muted} />
            عميل نقدي
          </span>
        </Abs>
        <Abs x={24} y={84} w={592} h={20} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: t.muted }}>
          <span style={{ width: 280 }}>الصنف</span>
          <span style={{ width: 130, textAlign: 'center' }}>الكمية</span>
          <span style={{ width: 150, textAlign: 'left' }}>الإجمالي</span>
        </Abs>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 112,
            width: 640,
            height: 88,
            background: t.primarySoft,
            borderRight: `3px solid ${t.primary}`,
            opacity: s.cartLineIn,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
          }}
        >
          <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 19, fontWeight: 600 }}>{SALE.product}</span>
            <span style={{ fontSize: 13, color: t.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Mono size={12} color={t.muted}>{SALE.sku}</Mono>·
              <Amount v={SALE.unitGross} size={12} weight={500} color={t.muted} />
              للوحدة
            </span>
          </div>
          <div style={{ width: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, direction: 'ltr' }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, display: 'grid', placeItems: 'center' }}>
              <Icon d={ICONS.minus} size={14} color={t.muted} />
            </span>
            <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, minWidth: 22, textAlign: 'center' }}>{s.qty}</span>
            <span style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, display: 'grid', placeItems: 'center' }}>
              <Icon d={ICONS.plus} size={14} color={t.primary} />
            </span>
          </div>
          <div style={{ width: 150, display: 'flex', justifyContent: 'flex-end', direction: 'ltr', fontSize: 20, fontWeight: 600 }}>{s.lineTotal}</div>
        </div>

        <Abs x={24} y={640} w={592} h={200}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 36, fontSize: 15, color: t.muted }}>
            <span>المجموع قبل الضريبة</span>
            <span style={{ color: t.text, fontSize: 17 }}>{s.subtotal}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 36, fontSize: 15, color: t.muted }}>
            <span>ضريبة القيمة المضافة 15%</span>
            <span style={{ color: t.text, fontSize: 17 }}>{s.vat}</span>
          </div>
          <div style={{ height: 1, background: t.border, margin: '14px 0 18px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 64 }}>
            <span style={{ fontSize: 20, fontWeight: 600 }}>الإجمالي</span>
            <span style={{ fontSize: 60, fontWeight: 600 }}>{s.total}</span>
          </div>
        </Abs>

        <div
          style={{
            position: 'absolute',
            left: 24,
            top: 872,
            width: 592,
            height: 72,
            borderRadius: 8,
            background: s.payPress > 0 ? `color-mix(in srgb, ${t.primary} ${100 - s.payPress * 18}%, #000)` : t.primary,
            transform: `scale(${1 - s.payPress * 0.015})`,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            overflow: 'hidden',
          }}
        >
          <span style={{ position: 'relative', height: 32, width: 260, overflow: 'hidden', fontSize: 21, fontWeight: 600 }}>
            <span style={{ position: 'absolute', right: 0, top: 0, transform: `translateY(${-s.payDone * 40}px)`, lineHeight: '32px' }}>دفع نقداً</span>
            <span style={{ position: 'absolute', right: 0, top: 0, transform: `translateY(${(1 - s.payDone) * 40}px)`, lineHeight: '32px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS.check} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.min(1, s.payDone * 1.4)} />
              </svg>
              تم الدفع
            </span>
          </span>
          <span style={{ direction: 'ltr', display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: MONO, fontSize: 21, fontWeight: 600 }}>
            {s.payAmount}
            <Riyal size={16} color="#fff" />
          </span>
        </div>
      </Card>
    </div>
  );
};
