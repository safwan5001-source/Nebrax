import React from 'react';
import { SANS, Theme } from '../config/theme';
import { SALE, fmt } from '../config/demo-data';
import { Abs, Amount, Card, Mono, Txt } from './common';
import { RollingNumber } from '../primitives/RollingNumber';
import { clamp01, ease, lerp } from '../lib/motion';

const CARD = { x: 64, y: 352, w: 1792 };
const HEAD = 52;
const ROW = 72;
const COL = {
  date: [1584, 1764],
  doc: [1290, 1560],
  type: [1070, 1270],
  in: [900, 1040],
  out: [730, 870],
  bal: [540, 700],
  val: [28, 320],
} as const;

/** World anchors for the hand-offs. */
export const INV = {
  outCell: { x: CARD.x + (COL.out[0] + COL.out[1]) / 2, y: CARD.y + HEAD + ROW / 2 },
  costLeft: { x: CARD.x + COL.val[0], y: CARD.y + HEAD + ROW / 2 },
  table: { x: 960, y: 560 },
};

type Row = { date: string; doc: string; type: string; inQ: string; outQ: string; bal: number; val: number };
const ROWS: Row[] = [
  { date: SALE.date, doc: SALE.invoice, type: 'بيع', inQ: '—', outQ: `−${SALE.qty}`, bal: SALE.stockAfter, val: SALE.cost },
  { date: '2026-09-28', doc: 'PUR-2026-00211', type: 'استلام مشتريات', inQ: '+48', outQ: '—', bal: 128, val: 864000 },
  { date: '2026-09-27', doc: 'INV-2026-00409', type: 'بيع', inQ: '—', outQ: '−6', bal: 80, val: 108000 },
  { date: '2026-09-26', doc: 'INV-2026-00401', type: 'بيع', inQ: '—', outQ: '−2', bal: 86, val: 36000 },
  { date: '2026-09-25', doc: 'OPN-2026-00003', type: 'رصيد افتتاحي', inQ: '+88', outQ: '—', bal: 88, val: 1584000 },
];
/** Rows arrive unsorted and settle into date order (row index → starting slot). */
const START_SLOT = [0, 3, 1, 4, 2];

export type InvState = {
  sort: number; // 0 unsorted → 1 sorted (staggered inside)
  minus: number; // "−" of the new movement appears
  balance: number; // roll 128 → 124
  cost: number; // highlight of the 720.00 cell
  hideCost: boolean;
  rowFocus: number;
};

export const InventoryScreen: React.FC<{ t: Theme; s: InvState }> = ({ t, s }) => {
  const cell = (c: readonly [number, number], align: 'left' | 'right' | 'center' = 'center'): React.CSSProperties => ({
    position: 'absolute',
    left: c[0],
    width: c[1] - c[0],
    textAlign: align,
    top: 0,
    height: ROW,
    display: 'flex',
    alignItems: 'center',
    justifyContent: align === 'center' ? 'center' : align === 'left' ? 'flex-end' : 'flex-start',
  });
  const cols: Array<[string, readonly [number, number], 'left' | 'right' | 'center']> = [
    ['التاريخ', COL.date, 'right'],
    ['المستند', COL.doc, 'right'],
    ['النوع', COL.type, 'right'],
    ['الوارد', COL.in, 'center'],
    ['الصادر', COL.out, 'center'],
    ['الرصيد', COL.bal, 'center'],
    ['التكلفة', COL.val, 'left'],
  ];
  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, background: t.bg, fontFamily: SANS, color: t.text }}>
      <Abs x={64} y={56} w={1792} style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.3 }}>حركة المخزون</div>
        <div style={{ fontSize: 16, color: t.muted, marginTop: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: t.text, fontWeight: 600 }}>{SALE.product}</span>·
          <Mono size={14} color={t.muted}>{SALE.sku}</Mono>·<span>المخزن الرئيسي — الدمام</span>·<span>متوسط مرجّح متحرك</span>
        </div>
      </Abs>

      {/* summary */}
      {[
        { label: 'الرصيد الحالي', x: 1280 },
        { label: 'متوسط التكلفة', x: 672 },
        { label: 'قيمة المخزون', x: 64 },
      ].map(({ label, x }, i) => (
        <Card key={label} t={t} x={x} y={170} w={576} h={150} r={8}>
          <Abs x={24} y={22} w={528} style={{ textAlign: 'right' }}>
            <Txt size={15} color={t.muted} weight={500}>
              {label}
            </Txt>
          </Abs>
          <Abs x={24} y={70} w={528} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 10, direction: 'ltr' }}>
            {i === 0 && (
              <>
                <RollingNumber from={String(SALE.stockBefore)} to={String(SALE.stockAfter)} progress={s.balance} style={{ fontSize: 52, fontWeight: 600 }} />
                <Txt size={16} color={t.muted}>وحدة</Txt>
              </>
            )}
            {i === 1 && <Amount v={SALE.unitCost} size={40} weight={600} color={t.text} />}
            {i === 2 && (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
                <RollingNumber from={fmt(128 * SALE.unitCost)} to={fmt(124 * SALE.unitCost)} progress={s.balance} style={{ fontSize: 40, fontWeight: 600 }} />
              </span>
            )}
          </Abs>
        </Card>
      ))}

      {/* movement ledger */}
      <Card t={t} x={CARD.x} y={CARD.y} w={CARD.w} h={HEAD + ROW * 5 + 8} r={8}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: CARD.w, height: HEAD, background: t.bg, borderBottom: `1px solid ${t.border}` }}>
          {cols.map(([label, c, a]) => (
            <div key={label} style={{ ...cell(c, a), height: HEAD, fontSize: 14, fontWeight: 600, color: t.muted }}>
              {label}
            </div>
          ))}
        </div>
        {ROWS.map((row, i) => {
          const local = clamp01((s.sort - Math.abs(START_SLOT[i] - i) * 0.04 - i * 0.05) / 0.7);
          const slot = lerp(START_SLOT[i], i, ease.rowSnap(local));
          const hero = i === 0;
          return (
            <div
              key={row.doc}
              style={{
                position: 'absolute',
                left: 0,
                top: HEAD + slot * ROW,
                width: CARD.w,
                height: ROW,
                borderBottom: `1px solid ${t.border}`,
                background: hero ? `color-mix(in srgb, ${t.primarySoft} ${Math.round(s.rowFocus * 100)}%, ${t.surface})` : t.surface,
                boxShadow: hero ? `inset -3px 0 0 ${t.primary}` : undefined,
                fontSize: 17,
              }}
            >
              <div style={cell(COL.date, 'right')}>
                <Mono size={16} color={t.muted}>{row.date}</Mono>
              </div>
              <div style={cell(COL.doc, 'right')}>
                <Mono size={16} color={hero ? t.primary : t.text} weight={hero ? 600 : 500}>
                  {row.doc}
                </Mono>
              </div>
              <div style={cell(COL.type, 'right')}>{row.type}</div>
              <div style={cell(COL.in)}>
                <Mono size={18} color={row.inQ === '—' ? t.muted : t.positive}>{row.inQ}</Mono>
              </div>
              <div style={cell(COL.out)}>
                {hero ? (
                  <Mono size={20} weight={600} color={t.text}>
                    <span style={{ display: 'inline-block', opacity: s.minus, transform: `translateX(${(1 - s.minus) * 12}px)`, color: t.negative }}>−</span>
                    {SALE.qty}
                  </Mono>
                ) : (
                  <Mono size={18} color={row.outQ === '—' ? t.muted : t.text}>{row.outQ}</Mono>
                )}
              </div>
              <div style={cell(COL.bal)}>
                {hero ? (
                  <RollingNumber from={String(SALE.stockBefore)} to={String(SALE.stockAfter)} progress={s.balance} style={{ fontSize: 18, fontWeight: 600 }} />
                ) : (
                  <Mono size={18}>{row.bal}</Mono>
                )}
              </div>
              <div style={{ ...cell(COL.val, 'left'), opacity: hero && s.hideCost ? 0 : 1 }}>
                <span
                  style={{
                    borderRadius: 6,
                    padding: '6px 10px',
                    margin: '0 -10px',
                    boxShadow: hero ? `0 0 0 ${2 * s.cost}px ${t.primary}` : undefined,
                  }}
                >
                  <Amount v={row.val} size={18} weight={hero ? 600 : 500} color={t.text} sign={false} />
                </span>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
};
