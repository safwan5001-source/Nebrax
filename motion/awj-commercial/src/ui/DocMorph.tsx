import React from 'react';
import { MONO, SANS, Theme } from '../config/theme';
import { SALE, fmt } from '../config/demo-data';
import { Amount, Badge, Mono } from './common';
import { Qr } from '../primitives/Qr';
import { clamp01, lerp } from '../lib/motion';

/**
 * One piece of paper, two documents: the POS thermal receipt (m = 0) becomes the A4 tax
 * invoice (m = 1). Laid out in screen space so the carried total can be handed in/out.
 */
export const RECEIPT = { x: 740, y: 140, w: 440, h: 800 };
export const INVOICE = { x: 400, y: 70, w: 1120, h: 1400 };

export const docBox = (m: number) => ({
  x: lerp(RECEIPT.x, INVOICE.x, m),
  y: lerp(RECEIPT.y, INVOICE.y, m),
  w: lerp(RECEIPT.w, INVOICE.w, m),
  h: lerp(RECEIPT.h, INVOICE.h, m),
});

/** Where the grand total rests (left edge, vertical centre) and its size. */
export const totalAnchor = (m: number) => ({
  x: lerp(RECEIPT.x + 28, INVOICE.x + 56, m),
  y: lerp(RECEIPT.y + 388, INVOICE.y + 652, m),
  size: lerp(40, 46, m),
});

export const QTY_CELL = { x: INVOICE.x + 626, y: INVOICE.y + 440 };

export type DocState = {
  m: number;
  print: number; // receipt line reveal 0..1
  lift: number; // receipt entry 0..1
  qr: number;
  iso: number; // isolate the qty cell
  qtyFocus: number;
};

const Line: React.FC<{ y: number; w: number; dashed?: boolean; color: string; x?: number }> = ({ y, w, dashed, color, x = 0 }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: w, height: 0, borderTop: `1px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
);

export const DocMorph: React.FC<{ t: Theme; s: DocState }> = ({ t, s }) => {
  const { m } = s;
  const box = docBox(m);
  const rOp = 1 - clamp01(m * 2.6);
  const iOp = clamp01((m - 0.42) * 2.4);
  const dim = 1 - 0.88 * s.iso;
  const line = (i: number, n: number) => clamp01(s.print * (n + 3) - i); // sequential printing
  const pr = (i: number, n = 12): React.CSSProperties => ({ opacity: line(i, n), transform: `translateY(${(1 - line(i, n)) * 6}px)` });

  // morphing row elements (screen space)
  const nameRight = 1920 - lerp(RECEIPT.x + RECEIPT.w - 28, INVOICE.x + INVOICE.w - 56, m);
  const nameTop = lerp(RECEIPT.y + 190, INVOICE.y + 416, m);
  const nameSize = lerp(17, 20, m);
  const ltLeft = lerp(RECEIPT.x + 28, INVOICE.x + 56, m);
  const ltTop = lerp(RECEIPT.y + 192, INVOICE.y + 428, m);
  const ltSize = lerp(16, 19, m);

  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, fontFamily: SANS, color: t.text }}>
      {/* paper */}
      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          background: t.surface,
          borderRadius: lerp(2, 6, m),
          boxShadow: `0 ${lerp(30, 18, m)}px ${lerp(60, 50, m)}px -20px rgba(21,24,29,${lerp(0.22, 0.12, m)}), 0 0 0 1px ${t.border}`,
          overflow: 'hidden',
        }}
      >
        {/* ——— receipt ——— */}
        <div style={{ position: 'absolute', inset: 0, opacity: rOp, width: RECEIPT.w, left: (box.w - RECEIPT.w) / 2 }}>
          <div style={{ position: 'absolute', top: 36, width: RECEIPT.w, textAlign: 'center', ...pr(0) }}>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{SALE.store}</div>
            <div style={{ fontSize: 12, color: t.muted, marginTop: 4 }}>
              الرقم الضريبي <Mono size={12} color={t.muted}>{SALE.vatNo}</Mono>
            </div>
          </div>
          <div style={{ position: 'absolute', top: 104, width: RECEIPT.w, textAlign: 'center', ...pr(1) }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>فاتورة ضريبية مبسطة</div>
            <div style={{ marginTop: 6 }}>
              <Mono size={13} color={t.muted}>
                {SALE.invoice} · {SALE.date} {SALE.time}
              </Mono>
            </div>
          </div>
          <div style={pr(2)}>
            <Line y={166} x={28} w={RECEIPT.w - 56} dashed color="#C9CED6" />
          </div>
          <div style={{ position: 'absolute', top: 222, right: 28, ...pr(3) }}>
            <Mono size={13} color={t.muted}>
              {SALE.qty} × {fmt(SALE.unitGross)}
            </Mono>
          </div>
          <div style={pr(4)}>
            <Line y={262} x={28} w={RECEIPT.w - 56} dashed color="#C9CED6" />
          </div>
          {[
            ['المجموع قبل الضريبة', SALE.subtotal, 282],
            ['ضريبة القيمة المضافة 15%', SALE.vat, 314],
          ].map(([label, v, y], i) => (
            <div key={String(label)} style={{ position: 'absolute', top: y as number, left: 28, right: 28, display: 'flex', justifyContent: 'space-between', fontSize: 14, color: t.muted, ...pr(5 + i) }}>
              <span>{label}</span>
              <Mono size={14} color={t.text}>{fmt(v as number)}</Mono>
            </div>
          ))}
          <div style={{ position: 'absolute', top: 372, right: 28, fontSize: 18, fontWeight: 600, ...pr(7) }}>الإجمالي</div>
          <div style={{ position: 'absolute', top: 430, left: 28, right: 28, display: 'flex', justifyContent: 'space-between', fontSize: 14, color: t.muted, ...pr(8) }}>
            <span>نقداً</span>
            <Mono size={14} color={t.text}>{fmt(SALE.total)}</Mono>
          </div>
          <div style={{ position: 'absolute', top: 458, left: 28, right: 28, display: 'flex', justifyContent: 'space-between', fontSize: 14, color: t.muted, ...pr(9) }}>
            <span>المتبقي</span>
            <Mono size={14} color={t.text}>0.00</Mono>
          </div>
          <div style={{ position: 'absolute', top: 512, left: (RECEIPT.w - 150) / 2, ...pr(10) }}>
            <Qr size={150} color={t.text} reveal={clamp01(s.print * 1.6 - 0.6)} />
          </div>
          <div style={{ position: 'absolute', top: 690, width: RECEIPT.w, textAlign: 'center', fontSize: 14, color: t.muted, ...pr(11) }}>شكراً لزيارتكم</div>
          {/* torn edge */}
          <svg width={RECEIPT.w} height={14} style={{ position: 'absolute', bottom: -1, left: 0 }} viewBox={`0 0 ${RECEIPT.w} 14`}>
            <path
              d={`M0 14 ${Array.from({ length: 23 }, (_, i) => `L${i * 20 + 10} 4 L${i * 20 + 20} 14`).join(' ')} Z`}
              fill={t.bg}
            />
          </svg>
        </div>

        {/* ——— invoice ——— */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: INVOICE.w, height: INVOICE.h, opacity: iOp, transform: `translate(${(box.w - INVOICE.w) / 2}px, ${(1 - iOp) * 10}px)` }}>
          <div style={{ opacity: dim }}>
            <div style={{ position: 'absolute', right: 56, top: 50, fontSize: 38, fontWeight: 700, lineHeight: 1.2 }}>فاتورة ضريبية</div>
            <div style={{ position: 'absolute', right: 56, top: 112, display: 'flex', gap: 14, alignItems: 'center' }}>
              <Mono size={19} color={t.primary} weight={600}>
                {SALE.invoice}
              </Mono>
              <Badge t={t}>مدفوعة</Badge>
            </div>
            <div style={{ position: 'absolute', right: 56, top: 152, fontSize: 15, color: t.muted }}>
              تاريخ الإصدار <Mono size={15} color={t.muted}>{SALE.date}</Mono>
            </div>
            <div style={{ position: 'absolute', left: 56, top: 44 }}>
              <Qr size={150} color={t.text} reveal={s.qr} />
            </div>
            <Line y={222} x={56} w={INVOICE.w - 112} color={t.border} />
            <div style={{ position: 'absolute', right: 56, top: 246, width: 420 }}>
              <div style={{ fontSize: 13, color: t.muted }}>البائع</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{SALE.store}</div>
              <div style={{ fontSize: 13, color: t.muted, marginTop: 4 }}>
                الرقم الضريبي <Mono size={13} color={t.muted}>{SALE.vatNo}</Mono>
              </div>
            </div>
            <div style={{ position: 'absolute', right: 560, top: 246, width: 300 }}>
              <div style={{ fontSize: 13, color: t.muted }}>العميل</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>عميل نقدي</div>
              <div style={{ fontSize: 13, color: t.muted, marginTop: 4 }}>الفرع الرئيسي — الدمام</div>
            </div>
            {/* table header */}
            <div style={{ position: 'absolute', left: 56, right: 56, top: 360, height: 48, background: t.bg, borderRadius: 6 }} />
            {[
              ['الصنف', 1064 - 364, 364, 'right'],
              ['الكمية', 576, 100, 'center'],
              ['سعر الوحدة', 416, 140, 'left'],
              ['الضريبة', 256, 140, 'left'],
              ['الإجمالي', 56, 180, 'left'],
            ].map(([label, x, w, align]) => (
              <div
                key={String(label)}
                style={{ position: 'absolute', left: (x as number) + (align === 'left' ? 16 : 0), top: 372, width: w as number, textAlign: align as 'left', fontSize: 14, fontWeight: 600, color: t.muted, paddingRight: align === 'right' ? 16 : 0 }}
              >
                {label}
              </div>
            ))}
            <div style={{ position: 'absolute', right: 72, top: 450, fontSize: 13, color: t.muted }}>
              <Mono size={12} color={t.muted}>{SALE.sku}</Mono> · {SALE.pack}
            </div>
            <div style={{ position: 'absolute', left: 416 + 16, top: 428 }}>
              <Mono size={19} color={t.text}>{fmt(SALE.unitNet)}</Mono>
            </div>
            <div style={{ position: 'absolute', left: 256 + 16, top: 428 }}>
              <Mono size={19} color={t.text}>{fmt(SALE.vat)}</Mono>
            </div>
            <Line y={480} x={56} w={INVOICE.w - 112} color={t.border} />
            {/* totals */}
            {[
              ['المجموع قبل الضريبة', SALE.subtotal, 528],
              ['ضريبة القيمة المضافة 15%', SALE.vat, 566],
            ].map(([label, v, y]) => (
              <div key={String(label)} style={{ position: 'absolute', left: 56, width: 440, top: y as number, display: 'flex', justifyContent: 'space-between', fontSize: 15, color: t.muted }}>
                <span>{label}</span>
                <Mono size={16} color={t.text}>{fmt(v as number)}</Mono>
              </div>
            ))}
            <Line y={608} x={56} w={440} color={t.border} />
            <div style={{ position: 'absolute', left: 56 + 440 - 120, width: 120, textAlign: 'right', top: 634, fontSize: 19, fontWeight: 600 }}>الإجمالي</div>
            <div style={{ position: 'absolute', right: 56, top: 540, width: 480, fontSize: 13, color: t.muted, lineHeight: 1.7 }}>
              فاتورة ضريبية صادرة وفق متطلبات الفوترة الإلكترونية.
              <br />
              طريقة الدفع: نقداً · <Amount v={SALE.total} size={13} weight={500} color={t.muted} />
            </div>
          </div>
          {/* qty cell — survives isolation */}
          <div
            style={{
              position: 'absolute',
              left: 576,
              top: 412,
              width: 100,
              height: 56,
              borderRadius: 6,
              boxShadow: `0 0 0 ${2 * s.qtyFocus}px ${t.primary}`,
              background: s.qtyFocus > 0 ? `rgba(30,64,175,${0.06 * s.qtyFocus})` : undefined,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: t.text, lineHeight: 1 }}>{SALE.qty}</span>
          </div>
        </div>
      </div>

      {/* morphing row: product name + line total travel from receipt line to invoice row */}
      <div style={{ opacity: m < 0.5 ? 1 : dim }}>
        <div style={{ position: 'absolute', right: nameRight, top: nameTop, fontSize: nameSize, fontWeight: 600, lineHeight: 1.2, opacity: rOp > 0 ? line(3, 12) : 1 }}>
          {SALE.product}
        </div>
        <div style={{ position: 'absolute', left: ltLeft, top: ltTop, opacity: rOp > 0 ? line(3, 12) : 1 }}>
          <Mono size={ltSize} color={t.text} weight={600}>
            {fmt(SALE.total)}
          </Mono>
        </div>
      </div>
    </div>
  );
};
