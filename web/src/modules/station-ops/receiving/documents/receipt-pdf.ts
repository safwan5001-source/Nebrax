import type { ReceiptDocument } from '../schemas';
import { dateText, filled, fitText, line, litersText, minorText, newPdf, paragraph, text, type PdfDoc } from './pdf-kit';

/**
 * FUEL-B5.1 — سند استلام وقود رسمي (A4 عمودي) يُرسم من حمولة `GET deliveries/{id}/document`.
 * النسخة التشغيلية بلا أي سعر/تكلفة/قيمة (الحمولة نفسها لا تحملها)؛ المالية تضيف كتلة التكلفة وتُوسَم صراحةً.
 * لا يحسب شيئاً: كل كمية وفرق ونسبة من الخادم.
 */

export interface ReceiptLabels {
  title: string; reference: string; status: Record<'draft' | 'approved', string>; variantOperational: string; variantFinancial: string;
  company: string; vat: string; cr: string; station: string; supplier: string; deliveryNote: string; purchaseRef: string; product: string; tank: string; warehouse: string;
  tanker: string; driver: string; receivedAt: string; quantities: string; dispatched: string; received: string; variance: string; variancePct: string; unit: string;
  readings: string; physical: string; atg: string; before: string; after: string; tankGain: string;
  cost: string; costTotal: string; costPerLiter: string; costRecordedBy: string; costMissing: string; currency: string;
  attachments: string; noAttachments: string; notes: string; receiver: string; approver: string; driverSignature: string; signature: string; notApproved: string;
  generatedBy: string; generatedAt: string; page: string; operationalNote: string;
}

const NAVY: [number, number, number] = [15, 39, 72];
const MUTED: [number, number, number] = [107, 114, 128];

export async function createReceiptPdf(doc: ReceiptDocument, labels: ReceiptLabels, locale: string): Promise<Blob> {
  const pdf = await newPdf('portrait');
  const rtl = locale.startsWith('ar');
  const W = 210; const M = 12; const L = M; const R = W - M;
  const start = rtl ? R : L;
  const end = rtl ? L : R;
  const sa: 'left' | 'right' = rtl ? 'right' : 'left';
  const ea: 'left' | 'right' = rtl ? 'left' : 'right';
  let y = 12;

  // ترويسة
  filled(pdf, L, y, R - L, 30, NAVY, 2);
  fitText(pdf, doc.company.name ?? '—', start === R ? R - 4 : L + 4, y + 9, 110, { size: 14, bold: true, align: sa, color: [255, 255, 255] });
  const ids = [doc.company.vat_number ? `${labels.vat}: ${doc.company.vat_number}` : null, doc.company.cr_number ? `${labels.cr}: ${doc.company.cr_number}` : null].filter(Boolean).join('   ');
  if (ids) fitText(pdf, ids, start === R ? R - 4 : L + 4, y + 15.5, 110, { size: 7.5, align: sa, color: [203, 213, 225] });
  fitText(pdf, labels.title, end === L ? L + 4 : R - 4, y + 9, 80, { size: 13, bold: true, align: ea, color: [255, 255, 255] });
  fitText(pdf, `${labels.reference}: ${doc.reference}`, end === L ? L + 4 : R - 4, y + 15.5, 80, { size: 8.5, align: ea, color: [203, 213, 225] });
  fitText(pdf, labels.status[(doc.status === 'approved' ? 'approved' : 'draft')], end === L ? L + 4 : R - 4, y + 21.5, 80, { size: 8.5, bold: true, align: ea, color: [255, 255, 255] });
  const financial = doc.variant === 'financial';
  filled(pdf, L, y + 30, R - L, 6, financial ? [180, 83, 9] : [37, 99, 235]);
  text(pdf, financial ? labels.variantFinancial : labels.variantOperational, (L + R) / 2, y + 34.2, { size: 8, bold: true, align: 'center', color: [255, 255, 255] });
  y += 44;

  const colW = (R - L - 8) / 2;
  const cellStart = (col: number) => (rtl ? R - col * (colW + 8) : L + col * (colW + 8));
  const row = (col: number, label: string, value: string | null | undefined, yy: number) => {
    const x0 = cellStart(col);
    const x1 = rtl ? x0 - colW : x0 + colW;
    text(pdf, label, x0, yy, { size: 8, color: MUTED, align: sa });
    fitText(pdf, value && value.trim() !== '' ? value : '—', x1, yy, colW - 28, { size: 9, bold: true, align: ea });
    line(pdf, Math.min(x0, x1), yy + 1.8, Math.max(x0, x1), yy + 1.8);
  };
  const grid = (pairs: Array<[string, string | null | undefined]>) => {
    pairs.forEach(([label, value], i) => row(i % 2, label, value, y + Math.floor(i / 2) * 7.2));
    y += Math.ceil(pairs.length / 2) * 7.2 + 4;
  };
  const heading = (title: string) => {
    filled(pdf, L, y - 3.8, R - L, 6.2, [241, 245, 249], 1);
    text(pdf, title, start, y + 0.5, { size: 9.5, bold: true, color: NAVY, align: sa });
    y += 7;
  };

  grid([
    [labels.station, doc.station?.name], [labels.supplier, doc.supplier?.name],
    [labels.deliveryNote, doc.delivery_note_number], [labels.purchaseRef, doc.purchase_reference],
    [labels.product, doc.product?.name], [labels.tank, doc.tank ? `${doc.tank.code ?? ''} ${doc.tank.name ?? ''}`.trim() : null],
    [labels.warehouse, doc.warehouse?.name], [labels.receivedAt, dateText(doc.received_at)],
    [labels.tanker, doc.tanker_identifier], [labels.driver, doc.driver_name],
  ]);

  heading(labels.quantities);
  grid([
    [labels.dispatched, `${litersText(doc.quantities.dispatched_liters)} ${labels.unit}`], [labels.received, `${litersText(doc.quantities.received_liters)} ${labels.unit}`],
    [labels.variance, `${litersText(doc.quantities.transit_variance_liters)} ${labels.unit}`], [labels.variancePct, doc.quantities.transit_variance_percent === null ? '—' : `${doc.quantities.transit_variance_percent}%`],
  ]);

  const r = doc.readings;
  const gain = (before: { liters: string } | null, after: { liters: string } | null) => {
    if (!before || !after) return null;
    const ml = (v: string) => Math.round(Number(v) * 1000);
    return litersText(((ml(after.liters) - ml(before.liters)) / 1000).toFixed(3));
  };
  const readingRows: Array<[string, string | null]> = [];
  for (const [kind, before, after] of [[labels.physical, r.before_physical, r.after_physical], [labels.atg, r.before_atg, r.after_atg]] as const) {
    if (!before && !after) continue;
    readingRows.push([`${kind} — ${labels.before}`, before ? `${litersText(before.liters)} ${labels.unit}` : null]);
    readingRows.push([`${kind} — ${labels.after}`, after ? `${litersText(after.liters)} ${labels.unit}` : null]);
    const g = gain(before, after);
    if (g !== null) { readingRows.push([`${kind} — ${labels.tankGain}`, `${g} ${labels.unit}`]); readingRows.push(['', null]); }
  }
  if (readingRows.length > 0) {
    heading(labels.readings);
    grid(readingRows.filter(([label]) => label !== ''));
  }

  if (doc.cost) {
    heading(labels.cost);
    grid([
      [labels.costTotal, doc.cost.total_minor === null ? labels.costMissing : `${minorText(doc.cost.total_minor)} ${doc.cost.currency}`],
      [labels.costPerLiter, doc.cost.per_liter === null ? '—' : `${doc.cost.per_liter} ${doc.cost.currency}`],
      [labels.costRecordedBy, doc.cost.recorded_by],
    ]);
  }

  heading(labels.attachments);
  if (doc.attachments.length === 0) { text(pdf, labels.noAttachments, start, y, { size: 8.5, color: MUTED, align: sa }); y += 6; }
  else doc.attachments.slice(0, 6).forEach((attachment) => { fitText(pdf, `• ${attachment.name}`, start, y, R - L, { size: 8.5, align: sa }); y += 5; });
  y += 2;

  if (doc.notes) {
    heading(labels.notes);
    y += paragraph(pdf, doc.notes, start, y, R - L, { size: 8.5, align: sa }) + 3;
  }

  // التوقيعات
  y = Math.max(y + 6, 232);
  const sigW = (R - L - 12) / 3;
  const sig = (i: number, role: string, name: string | null | undefined, when: string | null) => {
    const x0 = rtl ? R - i * (sigW + 6) : L + i * (sigW + 6);
    const xl = rtl ? x0 - sigW : x0;
    text(pdf, role, x0 + (rtl ? -sigW / 2 : sigW / 2), y, { size: 8.5, bold: true, align: 'center', color: NAVY });
    fitText(pdf, name ?? '—', x0 + (rtl ? -sigW / 2 : sigW / 2), y + 6, sigW - 2, { size: 8.5, align: 'center' });
    if (when) text(pdf, when, x0 + (rtl ? -sigW / 2 : sigW / 2), y + 11, { size: 7, align: 'center', color: MUTED });
    line(pdf, xl, y + 22, xl + sigW, y + 22, [107, 114, 128], 0.3);
    text(pdf, labels.signature, x0 + (rtl ? -sigW / 2 : sigW / 2), y + 26, { size: 7, align: 'center', color: MUTED });
  };
  sig(0, labels.receiver, doc.received_by, dateText(doc.received_at));
  sig(1, labels.approver, doc.approved_by ?? labels.notApproved, doc.approved_at ? dateText(doc.approved_at) : null);
  sig(2, labels.driverSignature, doc.driver_name, null);

  footers(pdf, labels, doc.generated_by, doc.generated_at, doc.variant === 'operational' ? labels.operationalNote : null, rtl);
  return pdf.output('blob');
}

export function footers(pdf: PdfDoc, labels: Pick<ReceiptLabels, 'generatedBy' | 'generatedAt' | 'page'>, by: string | null | undefined, at: string, note: string | null, rtl: boolean): void {
  const pages = pdf.getNumberOfPages();
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    line(pdf, 12, h - 14, w - 12, h - 14);
    const meta = [by ? `${labels.generatedBy}: ${by}` : null, `${labels.generatedAt}: ${dateText(at)}`].filter(Boolean).join('   ');
    fitText(pdf, meta, rtl ? w - 12 : 12, h - 9.5, w - 70, { size: 7, color: [107, 114, 128], align: rtl ? 'right' : 'left' });
    text(pdf, `${page} / ${pages}`, rtl ? 12 : w - 12, h - 9.5, { size: 7, color: [107, 114, 128], align: rtl ? 'left' : 'right' });
    if (note) fitText(pdf, note, rtl ? w - 12 : 12, h - 5.5, w - 24, { size: 6.5, color: [107, 114, 128], align: rtl ? 'right' : 'left' });
  }
}
