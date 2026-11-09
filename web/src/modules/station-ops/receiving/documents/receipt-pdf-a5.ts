import type { ReceiptDocument } from '../schemas';
import type { ReceiptLabels } from './receipt-pdf';
import { dateText, filled, fitLines, fitText, line, litersText, minorText, newPdf, text, textWidth, wrapLines, type PdfDoc } from './pdf-kit';

/**
 * AWJ-DOC-V2-PR6 — سند استلام وقود **A5 أفقي** (210×148مم) من حمولة `GET deliveries/{id}/document` نفسها (لا حقل جديد ولا طلب جديد).
 *
 * نسخة اختيارية بجانب سند A4 العمودي (`receipt-pdf.ts`) الذي لم يتغيّر: الاختيار من الواجهة، والافتراضي A4. الرسم متجهي (نص حقيقي قابل للاستخراج)
 * بالأدوات نفسها (`pdf-kit`: خط Noto العربي + Helvetica للاتيني/الأرقام 0–9). لا يحسب كمية ولا فرقاً ولا مبلغاً — كله من الخادم؛ النسخة التشغيلية
 * بلا أي سعر/تكلفة (الحمولة نفسها لا تحملها)، والمالية تضيف كتلة التكلفة.
 *
 * التخطيط: ترويسة ← شريط النسخة ← بيانات في 4 أعمدة (تسمية فوق قيمة، القيمة الطويلة تُصغَّر ثم تُلَفّ ولا تُقصّ) ← أربع كميات ← جدول القراءات ←
 * (التكلفة) ← المرفقات ← البيان ← ثلاثة توقيعات ← تذييل. ما لا يتسع في صفحة ينساب لصفحة تالية بترويسة مختصرة؛ كتلة التوقيع لا تنقسم.
 */

const NAVY: [number, number, number] = [15, 39, 72];
const MUTED: [number, number, number] = [107, 114, 128];
const SOFT: [number, number, number] = [241, 245, 249];

const W = 210;
const H = 148;
const M = 8;
const L = M;
const R = W - M;
/** آخر ارتفاع يبلغه المحتوى؛ بعده التذييل (خط + بيانات التوليد + ملاحظة النسخة). */
const CONTENT_BOTTOM = 131;
const SIGNATURE_HEIGHT = 19;

export async function createReceiptPdfA5(doc: ReceiptDocument, labels: ReceiptLabels, locale: string): Promise<Blob> {
  const pdf = await newPdf('landscape', 'a5');
  const rtl = locale.startsWith('ar');
  const sa: 'left' | 'right' = rtl ? 'right' : 'left';
  const ea: 'left' | 'right' = rtl ? 'left' : 'right';
  const start = rtl ? R : L;
  const financial = doc.variant === 'financial';
  let y = M;

  // ───── ترويسة ─────
  const header = () => {
    filled(pdf, L, y, R - L, 17, NAVY, 2);
    fitText(pdf, doc.company.name ?? '—', rtl ? R - 4 : L + 4, y + 6.8, 105, { size: 13, bold: true, align: sa, color: [255, 255, 255] });
    const ids = [doc.company.vat_number ? `${labels.vat}: ${doc.company.vat_number}` : null, doc.company.cr_number ? `${labels.cr}: ${doc.company.cr_number}` : null].filter(Boolean).join('   ');
    if (ids) fitText(pdf, ids, rtl ? R - 4 : L + 4, y + 12, 105, { size: 7, align: sa, color: [203, 213, 225] });
    const e = rtl ? L + 4 : R - 4;
    fitText(pdf, labels.title, e, y + 5.8, 78, { size: 12, bold: true, align: ea, color: [255, 255, 255] });
    fitText(pdf, `${labels.reference}: ${doc.reference}`, e, y + 10, 78, { size: 8, align: ea, color: [203, 213, 225] });
    fitText(pdf, labels.status[doc.status === 'approved' ? 'approved' : 'draft'], e, y + 14.2, 78, { size: 8, bold: true, align: ea, color: [255, 255, 255] });
    filled(pdf, L, y + 17, R - L, 5, financial ? [180, 83, 9] : [37, 99, 235]);
    text(pdf, financial ? labels.variantFinancial : labels.variantOperational, (L + R) / 2, y + 20.6, { size: 7, bold: true, align: 'center', color: [255, 255, 255] });
    y += 25.5;
  };
  /** ترويسة صفحة التتمة: شريط واحد بالمنشأة ورقم السند. */
  const continuation = () => {
    filled(pdf, L, y, R - L, 8, NAVY, 1.5);
    fitText(pdf, doc.company.name ?? '—', rtl ? R - 3 : L + 3, y + 5.4, 100, { size: 9, bold: true, align: sa, color: [255, 255, 255] });
    fitText(pdf, `${labels.title} — ${doc.reference}`, rtl ? L + 3 : R - 3, y + 5.4, 80, { size: 8, align: ea, color: [203, 213, 225] });
    y += 13;
  };
  header();

  /** ينقل إلى صفحة جديدة إن لم يتسع `height` فوق حدّ المحتوى. */
  const ensure = (height: number) => {
    if (y + height <= CONTENT_BOTTOM) return;
    pdf.addPage('a5', 'landscape');
    y = M;
    continuation();
  };

  // ───── شبكة: أعمدة بتسمية فوق قيمة ─────
  const GAP = 4;
  const edges = (index: number, count: number) => {
    const colW = (R - L - (count - 1) * GAP) / count;
    const x0 = rtl ? R - index * (colW + GAP) : L + index * (colW + GAP);
    return { x0, x1: rtl ? x0 - colW : x0 + colW, colW };
  };
  const grid = (pairs: Array<[string, string | null | undefined]>, columns = 4) => {
    for (let r = 0; r < pairs.length; r += columns) {
      const row = pairs.slice(r, r + columns);
      // ارتفاع الصف = أطول قيمة بعد اللفّ (يُقاس أولاً كي لا يتجاوز الصف حدّ الصفحة ولا تتداخل الخلايا).
      const lineCounts = row.map(([, value], i) => {
        const shown = value && value.trim() !== '' ? value : '—';
        const { colW } = edges(i, columns);
        return fitLinesCount(pdf, shown, colW, 8.5);
      });
      const rowHeight = 8.6 + (Math.max(...lineCounts) - 1) * 3.6;
      ensure(rowHeight + 1);
      row.forEach(([label, value], i) => {
        const { x0, x1, colW } = edges(i, columns);
        text(pdf, label, x0, y, { size: 7, color: MUTED, align: sa, maxWidth: colW });
        fitLines(pdf, value && value.trim() !== '' ? value : '—', x0, y + 4.2, colW, { size: 8.5, bold: true, align: sa }, 4);
        line(pdf, Math.min(x0, x1), y + rowHeight - 3, Math.max(x0, x1), y + rowHeight - 3);
      });
      y += rowHeight;
    }
    y += 2;
  };
  const heading = (title: string) => {
    ensure(9);
    filled(pdf, L, y - 3.2, R - L, 5, SOFT, 1);
    text(pdf, title, start, y + 0.3, { size: 8.5, bold: true, color: NAVY, align: sa });
    y += 5.2;
  };

  grid([
    [labels.station, doc.station?.name], [labels.supplier, doc.supplier?.name], [labels.deliveryNote, doc.delivery_note_number], [labels.purchaseRef, doc.purchase_reference],
    [labels.product, doc.product?.name], [labels.tank, doc.tank ? `${doc.tank.code ?? ''} ${doc.tank.name ?? ''}`.trim() : null], [labels.warehouse, doc.warehouse?.name], [labels.receivedAt, dateText(doc.received_at)],
    [labels.tanker, doc.tanker_identifier], [labels.driver, doc.driver_name],
  ]);

  // ───── الكميات: أربعة صناديق ─────
  ensure(14);
  const q = doc.quantities;
  const boxes: Array<[string, string]> = [
    [labels.dispatched, `${litersText(q.dispatched_liters)} ${labels.unit}`], [labels.received, `${litersText(q.received_liters)} ${labels.unit}`],
    [labels.variance, `${litersText(q.transit_variance_liters)} ${labels.unit}`], [labels.variancePct, q.transit_variance_percent === null ? '—' : `${q.transit_variance_percent}%`],
  ];
  boxes.forEach(([label, value], i) => {
    const { x0, x1, colW } = edges(i, 4);
    const left = Math.min(x0, x1);
    filled(pdf, left, y - 3, colW, 10.5, SOFT, 1);
    text(pdf, label, x0 + (rtl ? -2 : 2), y + 0.4, { size: 7, color: MUTED, align: sa, maxWidth: colW - 4 });
    fitText(pdf, value, x0 + (rtl ? -2 : 2), y + 5.4, colW - 4, { size: 10.5, bold: true, align: sa, color: NAVY });
  });
  y += 12;

  // ───── القراءات: جدول (النوع × قبل/بعد/الزيادة) ─────
  const r = doc.readings;
  const ml = (value: string) => Math.round(Number(value) * 1000);
  const gain = (before: { liters: string } | null, after: { liters: string } | null) => (before && after ? litersText(((ml(after.liters) - ml(before.liters)) / 1000).toFixed(3)) : null);
  const readingRows = ([[labels.physical, r.before_physical, r.after_physical], [labels.atg, r.before_atg, r.after_atg]] as const).filter(([, before, after]) => before || after);
  if (readingRows.length > 0) {
    heading(labels.readings);
    ensure(5 + readingRows.length * 5.2);
    const cols = [{ w: 46, label: '' }, { w: 46, label: labels.before }, { w: 46, label: labels.after }, { w: 46, label: labels.tankGain }];
    const cell = (index: number) => {
      const offset = cols.slice(0, index).reduce((sum, c) => sum + c.w, 0);
      return rtl ? R - offset : L + offset;
    };
    cols.forEach((c, i) => { if (c.label) text(pdf, c.label, cell(i), y, { size: 7, color: MUTED, align: sa, maxWidth: c.w - 2 }); });
    y += 4.2;
    readingRows.forEach(([kind, before, after]) => {
      const g = gain(before, after);
      text(pdf, kind, cell(0), y, { size: 8, bold: true, align: sa, maxWidth: 44 });
      [before, after].forEach((reading, i) => text(pdf, reading ? `${litersText(reading.liters)} ${labels.unit}` : '—', cell(i + 1), y, { size: 8.5, align: sa, maxWidth: 44 }));
      text(pdf, g === null ? '—' : `${g} ${labels.unit}`, cell(3), y, { size: 8.5, bold: true, align: sa, maxWidth: 44 });
      line(pdf, L, y + 1.6, R, y + 1.6);
      y += 4.8;
    });
    y += 0.5;
  }

  // ───── التكلفة (النسخة المالية فقط؛ الحمولة التشغيلية بلا cost) ─────
  if (doc.cost) {
    heading(labels.cost);
    grid([
      [labels.costTotal, doc.cost.total_minor === null ? labels.costMissing : `${minorText(doc.cost.total_minor)} ${doc.cost.currency}`],
      [labels.costPerLiter, doc.cost.per_liter === null ? '—' : `${doc.cost.per_liter} ${doc.cost.currency}`],
      [labels.costRecordedBy, doc.cost.recorded_by],
    ], 4);
  }

  // ───── المرفقات (سطر واحد) والبيان ─────
  ensure(6);
  const names = doc.attachments.slice(0, 3).map((attachment) => attachment.name);
  const extra = doc.attachments.length - names.length;
  const attachmentsText = doc.attachments.length === 0 ? labels.noAttachments : `${names.join('  •  ')}${extra > 0 ? `  (+${extra})` : ''}`;
  const attachLabel = `${labels.attachments}:`;
  const labelWidth = textWidth(pdf, attachLabel, 7.5, true) + 2.5;
  text(pdf, attachLabel, start, y, { size: 7.5, bold: true, color: MUTED, align: sa });
  fitText(pdf, attachmentsText, rtl ? R - labelWidth : L + labelWidth, y, R - L - labelWidth, { size: 8, align: sa, color: doc.attachments.length === 0 ? MUTED : [17, 24, 39] });
  y += 5.2;

  if (doc.notes) {
    const lines = wrapLines(pdf, doc.notes, R - L - 2, 8);
    ensure(4.4 + 3.8);
    text(pdf, `${labels.notes}:`, start, y, { size: 7.5, bold: true, color: MUTED, align: sa });
    y += 4;
    lines.forEach((content) => { ensure(4); text(pdf, content, start, y, { size: 8, align: sa }); y += 3.8; });
    y += 1;
  }

  // ───── التوقيعات: كتلة واحدة لا تنقسم، تُدفع إلى أسفل الصفحة ─────
  ensure(SIGNATURE_HEIGHT + 2);
  y = Math.max(y + 2, CONTENT_BOTTOM - SIGNATURE_HEIGHT);
  const sigW = (R - L - 12) / 3;
  const sig = (i: number, role: string, name: string | null | undefined, when: string | null) => {
    const x0 = rtl ? R - i * (sigW + 6) : L + i * (sigW + 6);
    const xl = rtl ? x0 - sigW : x0;
    const cx = x0 + (rtl ? -sigW / 2 : sigW / 2);
    text(pdf, role, cx, y, { size: 8, bold: true, align: 'center', color: NAVY, maxWidth: sigW });
    fitText(pdf, name ?? '—', cx, y + 4.4, sigW - 2, { size: 8.5, align: 'center' });
    if (when) text(pdf, when, cx, y + 8.2, { size: 7, align: 'center', color: MUTED });
    line(pdf, xl, y + 15, xl + sigW, y + 15, MUTED, 0.3);
    text(pdf, labels.signature, cx, y + 18.4, { size: 7, align: 'center', color: MUTED });
  };
  sig(0, labels.receiver, doc.received_by, dateText(doc.received_at));
  sig(1, labels.approver, doc.approved_by ?? labels.notApproved, doc.approved_at ? dateText(doc.approved_at) : null);
  sig(2, labels.driverSignature, doc.driver_name, null);

  footersA5(pdf, labels, doc.generated_by, doc.generated_at, financial ? null : labels.operationalNote, rtl);
  return pdf.output('blob');
}

/** عدد الأسطر التي ستستهلكها القيمة في خلية بعرض معيّن (نفس منطق `fitLines` بلا رسم). */
function fitLinesCount(pdf: PdfDoc, value: string, width: number, size: number): number {
  let s = size;
  while (s > 6.5 && textWidth(pdf, value, s, true) > width) s -= 0.5;
  if (textWidth(pdf, value, s, true) <= width) return 1;
  return Math.min(4, wrapLines(pdf, value, width, size, true).length);
}

/** تذييل A5: خط + من/متى + رقم الصفحة + ملاحظة النسخة التشغيلية، داخل هامش آمن للطابعات (≥ 5مم من الحافة). */
export function footersA5(pdf: PdfDoc, labels: Pick<ReceiptLabels, 'generatedBy' | 'generatedAt' | 'page'>, by: string | null | undefined, at: string, note: string | null, rtl: boolean): void {
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    line(pdf, L, H - 14, R, H - 14);
    const meta = [by ? `${labels.generatedBy}: ${by}` : null, `${labels.generatedAt}: ${dateText(at)}`].filter(Boolean).join('   ');
    fitText(pdf, meta, rtl ? R : L, H - 9.8, R - L - 30, { size: 7, color: MUTED, align: rtl ? 'right' : 'left' });
    text(pdf, `${page} / ${pages}`, rtl ? L : R, H - 9.8, { size: 7, color: MUTED, align: rtl ? 'left' : 'right' });
    if (note) fitText(pdf, note, rtl ? R : L, H - 5.6, R - L, { size: 6.5, color: MUTED, align: rtl ? 'right' : 'left' });
  }
}
