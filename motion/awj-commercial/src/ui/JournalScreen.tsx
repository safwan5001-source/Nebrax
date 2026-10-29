import React from 'react';
import { SANS, Theme } from '../config/theme';
import { SALE, fmt } from '../config/demo-data';
import { Abs, Badge, Card, Mono } from './common';
import { RollingNumber } from '../primitives/RollingNumber';
import { clamp01, ease } from '../lib/motion';

const X = 64;
const W = 1792;
const DEBIT_R = 1000; // right edge of debit numbers (card-relative, LTR px)
const CREDIT_R = 560;
const E1 = { y: 150, rows: [122, 194, 266], total: 350, h: 440 };
const E2 = { y: 620, rows: [122, 194], total: 278, h: 368 };
const ROW = 72;
export const MONO_W = 0.6; // IBM Plex Mono advance (em)

const leftOf = (right: number, text: string, size: number) => right - text.length * MONO_W * size;
const BAR = { l: CREDIT_R + 36, w: leftOf(DEBIT_R, fmt(SALE.total), 26) - 36 - (CREDIT_R + 36) };

/** World anchors (left edge, vertical centre) for carried values. */
export const JR = {
  costDebit: { x: X + leftOf(DEBIT_R, fmt(SALE.cost), 20), y: E2.y + E2.rows[0] + ROW / 2 },
  costCredit: { x: X + leftOf(CREDIT_R, fmt(SALE.cost), 20), y: E2.y + E2.rows[1] + ROW / 2 },
  sumDebit: { x: X + leftOf(DEBIT_R, fmt(SALE.total), 26), y: E1.y + E1.total + 40 },
  sumCredit: { x: X + leftOf(CREDIT_R, fmt(SALE.total), 26), y: E1.y + E1.total + 40 },
  mid: { x: X + (DEBIT_R + CREDIT_R) / 2 - 30, y: E1.y + E1.total + 40 },
};

export type JrState = {
  costDr: boolean; // 720.00 landed in the debit cell
  costCr: boolean; // …and its split copy in the credit cell
  sale: number; // 0..1 staggered sale lines
  sums: number; // Σ roll 0 → 1,250.00
  lock: number; // balance lock
  hideSums: boolean;
  dimRest: number;
};

type Line = { code: string; name: string; dr?: number; cr?: number };

export const JournalScreen: React.FC<{ t: Theme; s: JrState }> = ({ t, s }) => {
  const header = (y: number) => (
    <div style={{ position: 'absolute', left: 0, top: y, width: W, height: 44, background: t.bg, borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}`, fontSize: 14, fontWeight: 600, color: t.muted }}>
      <span style={{ position: 'absolute', right: 28, top: 11 }}>الحساب</span>
      <span style={{ position: 'absolute', left: DEBIT_R - 60, width: 60, textAlign: 'left', top: 11 }}>مدين</span>
      <span style={{ position: 'absolute', left: CREDIT_R - 60, width: 60, textAlign: 'left', top: 11 }}>دائن</span>
    </div>
  );
  const num = (v: number | undefined, right: number, show: number, size = 20) =>
    v === undefined ? null : (
      <span style={{ position: 'absolute', left: right - 400, width: 400, textAlign: 'right', top: 0, height: ROW, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', direction: 'ltr', opacity: show, transform: `translateX(${(1 - show) * -60}px)` }}>
        <Mono size={size} weight={600} color={t.text}>
          {fmt(v)}
        </Mono>
      </span>
    );
  const line = (l: Line, y: number, show: number, key: string, drShow = show, crShow = show) => (
    <div key={key} style={{ position: 'absolute', left: 0, top: y, width: W, height: ROW, borderBottom: `1px solid ${t.border}` }}>
      <span style={{ position: 'absolute', right: 28, top: 0, height: ROW, display: 'flex', alignItems: 'center', gap: 14, fontSize: 18, opacity: 0.35 + 0.65 * show }}>
        <Mono size={17} color={t.muted}>{l.code}</Mono>
        <span style={{ fontWeight: 500 }}>{l.name}</span>
      </span>
      {num(l.dr, DEBIT_R, drShow)}
      {num(l.cr, CREDIT_R, crShow)}
    </div>
  );
  const saleLines: Line[] = [
    { code: '1110', name: 'الصندوق', dr: SALE.total },
    { code: '4110', name: 'إيرادات المبيعات', cr: SALE.subtotal },
    { code: '2120', name: 'ضريبة القيمة المضافة — مخرجات', cr: SALE.vat },
  ];
  const lk = ease.snap(s.lock);
  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, background: t.bg, fontFamily: SANS, color: t.text }}>
      <Abs x={64} y={44} w={1792} style={{ textAlign: 'right', opacity: 1 - s.dimRest }}>
        <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.3 }}>قيود اليومية</div>
        <div style={{ fontSize: 16, color: t.muted, marginTop: 4 }}>
          مرحّلة تلقائياً من <Mono size={15} color={t.primary} weight={600}>{SALE.invoice}</Mono>
        </div>
      </Abs>

      {/* sale entry */}
      <Card t={t} x={X} y={E1.y} w={W} h={E1.h} r={8}>
        <div style={{ opacity: 1 - s.dimRest }}>
          <div style={{ position: 'absolute', right: 28, top: 24, display: 'flex', gap: 14, alignItems: 'center' }}>
            <Mono size={18} color={t.primary} weight={600}>{SALE.journalSale}</Mono>
            <span style={{ fontSize: 17, fontWeight: 600 }}>قيد مبيعات</span>
            <Badge t={t}>مرحّل</Badge>
          </div>
          <div style={{ position: 'absolute', left: 28, top: 26 }}>
            <Mono size={15} color={t.muted}>{SALE.date}</Mono>
          </div>
          {header(78)}
          {saleLines.map((l, i) => line(l, E1.rows[i], ease.rowSnap(clamp01(s.sale * 3 - i * 0.9)), l.code))}
        </div>
        {/* totals */}
        <div style={{ position: 'absolute', left: 0, top: E1.total, width: W, height: 80, borderTop: `2px solid color-mix(in srgb, ${lk > 0 ? t.primary : t.border} ${Math.round(100 * (1 - s.dimRest))}%, transparent)` }}>
          <span style={{ position: 'absolute', right: 28, top: 24, fontSize: 18, fontWeight: 700, opacity: 1 - s.dimRest }}>الإجمالي</span>
          {!s.hideSums && (
            <>
              <span style={{ position: 'absolute', left: DEBIT_R - 400, width: 400, top: 27, display: 'flex', justifyContent: 'flex-end', direction: 'ltr' }}>
                <RollingNumber from="0.00" to={fmt(SALE.total)} progress={s.sums} style={{ fontSize: 26, fontWeight: 700, color: t.text }} />
              </span>
              <span style={{ position: 'absolute', left: CREDIT_R - 400, width: 400, top: 27, display: 'flex', justifyContent: 'flex-end', direction: 'ltr' }}>
                <RollingNumber from="0.00" to={fmt(SALE.total)} progress={s.sums} style={{ fontSize: 26, fontWeight: 700, color: t.text }} />
              </span>
            </>
          )}
          {/* the balance lock: an equals bar closes between the two columns */}
          {[33, 45].map((y) => (
            <div key={y} style={{ position: 'absolute', left: BAR.l + (BAR.w * (1 - lk)) / 2, width: BAR.w * lk, top: y, height: 3, background: t.primary, opacity: s.hideSums ? 0 : 1 }} />
          ))}
          <span style={{ position: 'absolute', left: 28, top: 22, opacity: lk * (1 - s.dimRest), transform: `scale(${0.9 + 0.1 * lk})` }}>
            <Badge t={t} tone="primary" size={15}>
              متوازن
            </Badge>
          </span>
        </div>
      </Card>

      {/* cost entry — fed by the stock movement */}
      <Card t={t} x={X} y={E2.y} w={W} h={E2.h} r={8} style={{ opacity: 1 - s.dimRest }}>
        <div style={{ position: 'absolute', right: 28, top: 24, display: 'flex', gap: 14, alignItems: 'center' }}>
          <Mono size={18} color={t.primary} weight={600}>{SALE.journalCost}</Mono>
          <span style={{ fontSize: 17, fontWeight: 600 }}>قيد تكلفة المبيعات</span>
          <Badge t={t}>مرحّل</Badge>
        </div>
        {header(78)}
        {line({ code: '5110', name: 'تكلفة البضاعة المباعة', dr: SALE.cost }, E2.rows[0], 1, 'c1', s.costDr ? 1 : 0, 0)}
        {line({ code: '1140', name: 'المخزون', cr: SALE.cost }, E2.rows[1], 1, 'c2', 0, s.costCr ? 1 : 0)}
        <div style={{ position: 'absolute', left: 0, top: E2.total, width: W, height: 80 }}>
          <span style={{ position: 'absolute', right: 28, top: 22, fontSize: 17, fontWeight: 700 }}>الإجمالي</span>
          <span style={{ position: 'absolute', left: DEBIT_R - 400, width: 400, top: 24, display: 'flex', justifyContent: 'flex-end', direction: 'ltr', opacity: s.costDr ? 1 : 0.25 }}>
            <Mono size={20} weight={700}>{s.costDr ? fmt(SALE.cost) : '0.00'}</Mono>
          </span>
          <span style={{ position: 'absolute', left: CREDIT_R - 400, width: 400, top: 24, display: 'flex', justifyContent: 'flex-end', direction: 'ltr', opacity: s.costCr ? 1 : 0.25 }}>
            <Mono size={20} weight={700}>{s.costCr ? fmt(SALE.cost) : '0.00'}</Mono>
          </span>
        </div>
      </Card>
    </div>
  );
};
