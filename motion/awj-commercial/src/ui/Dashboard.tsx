import React from 'react';
import { SANS, Theme } from '../config/theme';
import { KPI, SALE, SALES_CURVE, SALES_HOURS, fmt } from '../config/demo-data';
import { Abs, Amount, Badge, Card, Icon, ICONS, Mono, Txt } from './common';
import { RollingNumber } from '../primitives/RollingNumber';
import { Riyal } from '../primitives/Riyal';
import { clamp01, ease, lerp } from '../lib/motion';

/** Chart geometry (world px) — the journal's balanced total lands on its last point. */
const CH = { x: 24, y: 352, w: 1060, h: 420 };
const PLOT = { l: CH.x + 72, r: CH.x + CH.w - 48, t: CH.y + 110, b: CH.y + CH.h - 56 };
const VMAX = 5000000; // 50,000.00
const px = (h: number) => lerp(PLOT.l, PLOT.r, h / 5);
const py = (v: number) => PLOT.b - (v / VMAX) * (PLOT.b - PLOT.t);

export const DASH = {
  endBefore: { x: px(SALES_HOURS[5]), y: py(SALES_CURVE[5]) },
  endAfter: { x: px(SALES_HOURS[5]), y: py(KPI.salesToday[1]) },
};

export type DashState = {
  rise: number; // endpoint rises with the sale
  kpi: number; // KPI rolls
  row: number; // new invoice row
  chrome: number; // everything but the chart line (fades in on pull-back)
};

const NAV: Array<[string, Array<[string, keyof typeof ICONS]>]> = [
  ['', [['لوحة التحكم', 'grid']]],
  ['المبيعات', [['الفواتير', 'receipt'], ['نقاط البيع', 'pos'], ['العملاء', 'users']]],
  ['المخزون', [['المنتجات', 'box'], ['المشتريات', 'truck'], ['تقارير المخزون', 'chart']]],
  ['الحسابات', [['دليل الحسابات', 'book'], ['قيود اليومية', 'book']]],
  ['المالية', [['المصروفات', 'wallet'], ['الخزائن والبنوك', 'cash']]],
  ['الإعدادات', [['التقارير', 'chart'], ['المتجر', 'store']]],
];

export const Sidebar: React.FC<{ t: Theme; active?: string }> = ({ t, active = 'لوحة التحكم' }) => (
  <Abs x={1672} y={0} w={248} h={1080} style={{ background: t.surface, borderLeft: `1px solid ${t.border}` }}>
    <Abs x={0} y={0} w={248} h={64} style={{ display: 'flex', alignItems: 'center', padding: '0 24px', borderBottom: `1px solid ${t.border}` }}>
      <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 28, color: t.primary, lineHeight: 1 }}>أَوْج</span>
    </Abs>
    <Abs x={12} y={80} w={224}>
      {NAV.map(([group, items]) => (
        <div key={group || 'root'} style={{ marginBottom: 10 }}>
          {group && <div style={{ fontSize: 12, fontWeight: 600, color: t.muted, padding: '8px 12px 6px' }}>{group}</div>}
          {items.map(([label, icon]) => {
            const on = label === active;
            return (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  height: 38,
                  padding: '0 12px',
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: on ? 600 : 500,
                  color: on ? t.primary : t.text,
                  background: on ? t.primarySoft : undefined,
                  boxShadow: on ? `inset -3px 0 0 ${t.primary}` : undefined,
                }}
              >
                <Icon d={ICONS[icon]} size={17} color={on ? t.primary : t.muted} />
                {label}
              </div>
            );
          })}
        </div>
      ))}
    </Abs>
  </Abs>
);

export const TopBar: React.FC<{ t: Theme; title?: string }> = ({ t }) => (
  <Abs x={0} y={0} w={1672} h={64} style={{ background: t.surface, borderBottom: `1px solid ${t.border}` }}>
    <Card t={t} x={1100} y={12} w={548} h={40} r={8} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: t.bg }}>
      <Icon d={ICONS.search} size={16} color={t.muted} />
      <Txt size={14} color={t.muted}>ابحث في أَوْج…</Txt>
    </Card>
    <Abs x={24} y={0} h={64} style={{ display: 'flex', alignItems: 'center', gap: 18, direction: 'ltr' }}>
      <span style={{ width: 34, height: 34, borderRadius: 999, background: t.primarySoft, color: t.primary, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 600, fontFamily: SANS }}>س</span>
      <Icon d={ICONS.bell} size={18} color={t.muted} />
      <Txt size={14} color={t.muted}>الفرع الرئيسي — الدمام</Txt>
    </Abs>
  </Abs>
);

const Spark: React.FC<{ pts: number[]; color: string; w?: number; h?: number }> = ({ pts, color, w = 120, h = 34 }) => {
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * w} ${h - ((v - min) / (max - min || 1)) * h}`).join(' ');
  return (
    <svg width={w} height={h + 4} style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={w} cy={h - ((pts[pts.length - 1] - min) / (max - min || 1)) * h} r={3} fill={color} />
    </svg>
  );
};

export const Dashboard: React.FC<{ t: Theme; s: DashState }> = ({ t, s }) => {
  const k = ease.digit(s.kpi);
  const cards = [
    { label: 'مبيعات اليوم', v: KPI.salesToday, icon: ICONS.trend, delta: SALE.total, spark: [2, 4, 3, 6, 5, 8, 9] },
    { label: 'النقد والبنك', v: KPI.cash, icon: ICONS.wallet, delta: SALE.total, spark: [5, 4, 6, 5, 7, 6, 8] },
    { label: 'ذمم العملاء', v: KPI.receivables, icon: ICONS.users, delta: 0, spark: [6, 7, 5, 6, 6, 5, 6] },
    { label: 'قيمة المخزون', v: KPI.stockValue, icon: ICONS.box, delta: -SALE.cost, spark: [7, 8, 7, 6, 7, 6, 5] },
  ];
  const endY = lerp(DASH.endBefore.y, DASH.endAfter.y, ease.snap(s.rise));
  const pts = SALES_CURVE.map((v, i) => ({ x: px(SALES_HOURS[i]), y: i === SALES_CURVE.length - 1 ? endY : py(v) }));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x} ${PLOT.b} L${pts[0].x} ${PLOT.b} Z`;
  const c = s.chrome;
  const invoices: Array<[string, string, number, string]> = [
    [SALE.invoice, 'عميل نقدي', SALE.total, 'مدفوعة'],
    ['INV-2026-00417', 'مؤسسة الواحة للتجارة', 483000, 'جزئية'],
    ['INV-2026-00416', 'شركة الساحل للنقل', 1245000, 'مدفوعة'],
    ['INV-2026-00415', 'عميل نقدي', 18500, 'مدفوعة'],
    ['INV-2026-00414', 'مؤسسة الأفق للمقاولات', 276000, 'غير مدفوعة'],
    ['INV-2026-00413', 'عميل نقدي', 9200, 'مدفوعة'],
  ];
  const rowT = ease.rowSnap(s.row);
  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, background: t.bg, fontFamily: SANS, color: t.text }}>
      <div style={{ opacity: c }}>
        <Sidebar t={t} />
        <TopBar t={t} />
        <Abs x={24} y={84} w={1624} h={60} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 34, fontWeight: 700 }}>لوحة التحكم</span>
          <span style={{ display: 'flex', gap: 10, fontSize: 14 }}>
            {['اليوم', 'الأسبوع', 'الشهر'].map((l, i) => (
              <span key={l} style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${i === 0 ? t.primary : t.border}`, background: i === 0 ? t.primarySoft : t.surface, color: i === 0 ? t.primary : t.text, fontWeight: i === 0 ? 600 : 500 }}>
                {l}
              </span>
            ))}
          </span>
        </Abs>
        {cards.map((cd, i) => {
          const x = 1257 - i * 411;
          return (
            <Card key={cd.label} t={t} x={x} y={160} w={391} h={172} r={16}>
              <Abs x={20} y={18} w={351} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: t.muted }}>{cd.label}</span>
                <Icon d={cd.icon} size={17} color={t.muted} />
              </Abs>
              <Abs x={20} y={52} w={351} style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'baseline', gap: 8, direction: 'rtl' }}>
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, direction: 'ltr' }}>
                  <RollingNumber from={fmt(cd.v[0])} to={fmt(cd.v[1])} progress={k} style={{ fontSize: 32, fontWeight: 700 }} />
                  <Riyal size={22} color={t.text} />
                </span>
              </Abs>
              <Abs x={20} y={98} w={351} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Spark pts={cd.spark} color={t.primary} />
              </Abs>
              <Abs x={20} y={136} w={351} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px dashed ${t.border}`, paddingTop: 10 }}>
                <span style={{ fontSize: 12, color: t.muted }}>منذ آخر عملية</span>
                <span style={{ opacity: cd.delta === 0 ? 0.5 : k, display: 'flex' }}>
                  <Mono size={14} weight={700} color={cd.delta > 0 ? t.positive : cd.delta < 0 ? t.negative : t.muted}>
                    {cd.delta > 0 ? '+' : ''}
                    {cd.delta === 0 ? '0.00' : fmt(cd.delta)}
                  </Mono>
                </span>
              </Abs>
            </Card>
          );
        })}

        {/* latest invoices */}
        <Card t={t} x={1104} y={352} w={544} h={420} r={16}>
          <Abs x={20} y={20} w={504} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>آخر الفواتير</span>
            <span style={{ fontSize: 13, color: t.primary }}>عرض الكل</span>
          </Abs>
          <div style={{ position: 'absolute', left: 0, top: 64, width: 544, height: 340, overflow: 'hidden' }}>
            {invoices.map(([no, who, v, st], i) => {
              const y = (i === 0 ? -1 + rowT : i - 1 + rowT) * 58;
              return (
                <div
                  key={no}
                  style={{
                    position: 'absolute',
                    left: 20,
                    right: 20,
                    top: y,
                    height: 58,
                    borderBottom: `1px solid ${t.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    opacity: i === 0 ? rowT : 1,
                    background: i === 0 ? `color-mix(in srgb, ${t.primarySoft} ${Math.round((1 - clamp01((s.row - 1) * 1)) * 100)}%, ${t.surface})` : undefined,
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Mono size={14} color={i === 0 ? t.primary : t.text} weight={600}>
                      {no}
                    </Mono>
                    <span style={{ fontSize: 13, color: t.muted }}>{who}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Badge t={t} tone={st === 'مدفوعة' ? 'positive' : 'muted'} size={12}>
                      {st}
                    </Badge>
                    <Amount v={v} size={15} weight={600} color={t.text} />
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* bottom row */}
        <Card t={t} x={836} y={792} w={812} h={264} r={16}>
          <Abs x={24} y={22} w={764} style={{ fontSize: 17, fontWeight: 600, textAlign: 'right' }}>
            الإيرادات مقابل المصروفات
          </Abs>
          {[
            ['إجمالي المبيعات', 48250000, 0.92, t.positive],
            ['المصروفات', 26466000, 0.5, t.negative],
          ].map(([label, v, w, col], i) => (
            <Abs key={String(label)} x={24} y={84 + i * 80} w={764}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: t.muted }}>
                <span>{label}</span>
                <Amount v={v as number} size={15} weight={600} color={t.text} />
              </div>
              <div style={{ marginTop: 12, height: 10, borderRadius: 999, background: t.bg, overflow: 'hidden', direction: 'rtl' }}>
                <div style={{ width: `${(w as number) * 100}%`, height: 10, background: col as string, borderRadius: 999 }} />
              </div>
            </Abs>
          ))}
        </Card>
        <Card t={t} x={24} y={792} w={792} h={264} r={16}>
          <Abs x={24} y={22} w={744} style={{ fontSize: 17, fontWeight: 600, textAlign: 'right' }}>
            حالة سداد الفواتير
          </Abs>
          <svg width={150} height={150} style={{ position: 'absolute', right: 40, top: 80 }} viewBox="0 0 42 42">
            {[
              [0.62, t.positive, 0],
              [0.23, t.warning, 0.62],
              [0.15, t.muted, 0.85],
            ].map(([len, col, off]) => (
              <circle key={String(off)} cx="21" cy="21" r="15.9" fill="none" stroke={col as string} strokeWidth="5" strokeDasharray={`${(len as number) * 100} ${100 - (len as number) * 100}`} strokeDashoffset={25 - (off as number) * 100} pathLength={100} />
            ))}
          </svg>
          <Abs x={380} y={100} w={200} style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 14 }}>
            {[
              ['مدفوعة', '62%', t.positive],
              ['جزئية', '23%', t.warning],
              ['غير مدفوعة', '15%', t.muted],
            ].map(([l, v, col]) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: col }} />
                <span style={{ flex: 1 }}>{l}</span>
                <Mono size={14} color={t.muted}>{v}</Mono>
              </span>
            ))}
          </Abs>
        </Card>
      </div>

      {/* sales chart — the line survives the zoom, its frame appears with the chrome */}
      <Card t={t} x={CH.x} y={CH.y} w={CH.w} h={CH.h} r={16} style={{ background: c < 1 ? `color-mix(in srgb, ${t.surface} ${Math.round(c * 100)}%, ${t.bg})` : t.surface, borderColor: c < 1 ? 'transparent' : t.border }} />
      <div style={{ opacity: c }}>
        <Abs x={CH.x + 24} y={CH.y + 22} w={CH.w - 48} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>المبيعات اليوم — تراكمي</span>
          <span style={{ display: 'flex', gap: 22, fontSize: 14, color: t.muted }}>
            {['بالساعة', 'الفروع', 'المنتجات'].map((l, i) => (
              <span key={l} style={{ color: i === 0 ? t.primary : t.muted, fontWeight: i === 0 ? 600 : 500, borderBottom: i === 0 ? `2px solid ${t.primary}` : undefined, paddingBottom: 4 }}>
                {l}
              </span>
            ))}
          </span>
        </Abs>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', left: PLOT.l, width: PLOT.r - PLOT.l, top: py((i * VMAX) / 5), height: 1, background: t.border }} />
            <span style={{ position: 'absolute', left: CH.x + 14, top: py((i * VMAX) / 5) - 9 }}>
              <Mono size={12} color={t.muted}>
                {i * 10}k
              </Mono>
            </span>
            <span style={{ position: 'absolute', left: px(i) - 20, top: PLOT.b + 14 }}>
              <Mono size={12} color={t.muted}>
                {String(6 + i).padStart(2, '0')}:00
              </Mono>
            </span>
          </React.Fragment>
        ))}
      </div>
      <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        <path d={area} fill={t.primary} opacity={0.07 * c} />
        <path d={line} fill="none" stroke={t.primary} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={pts[pts.length - 1].x} cy={endY} r={6} fill={t.primary} />
        <circle cx={pts[pts.length - 1].x} cy={endY} r={11} fill="none" stroke={t.primary} strokeOpacity={0.25 * c} strokeWidth={2} />
      </svg>
      <div style={{ position: 'absolute', left: pts[pts.length - 1].x - 150, top: endY - 58, width: 138, textAlign: 'right', opacity: c * ease.snap(s.kpi) }}>
        <Mono size={13} color={t.muted}>
          {SALE.time}
        </Mono>
        <div>
          <Amount v={KPI.salesToday[1]} size={15} weight={700} color={t.text} />
        </div>
      </div>
    </div>
  );
};
