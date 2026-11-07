import type { ReceiptReport } from '../schemas';
import { dateText, filled, fitText, line, litersText, minorText, newPdf, text } from './pdf-kit';
import { footers, type ReceiptLabels } from './receipt-pdf';

/** FUEL-B5.1 — كشف الاستلامات (A4 أفقي): جدول بصفوف الخادم وإجماليه؛ التشغيلي بلا عمود تكلفة أبداً. لا يعيد حساب شيء. */

export interface ReportLabels extends Pick<ReceiptLabels, 'company' | 'vat' | 'cr' | 'status' | 'variantOperational' | 'variantFinancial' | 'unit' | 'generatedBy' | 'generatedAt' | 'page' | 'operationalNote' | 'reference' | 'supplier' | 'product' | 'tank' | 'station' | 'deliveryNote' | 'dispatched' | 'received' | 'variance'> {
  title: string; date: string; stateCol: string; total: string; count: string; costCol: string; uncosted: string; truncated: string; empty: string; filtersTitle: string;
  filterLabels: Record<string, string>;
}

const NAVY: [number, number, number] = [15, 39, 72];

export async function createReportPdf(report: ReceiptReport, labels: ReportLabels, locale: string): Promise<Blob> {
  const pdf = await newPdf('landscape');
  const rtl = locale.startsWith('ar');
  const W = 297; const M = 10; const L = M; const R = W - M; const TW = R - L;
  const financial = report.variant === 'financial';
  const sa: 'left' | 'right' = rtl ? 'right' : 'left';
  const ea: 'left' | 'right' = rtl ? 'left' : 'right';
  const start = rtl ? R : L;

  const cols: Array<{ key: string; label: string; w: number; numeric?: boolean; get: (r: ReceiptReport['rows'][number]) => string }> = [
    { key: 'ref', label: labels.reference, w: 24, get: (r) => r.reference },
    { key: 'date', label: labels.date, w: 30, get: (r) => dateText(r.received_at) },
    { key: 'status', label: labels.stateCol, w: 18, get: (r) => labels.status[r.status === 'approved' ? 'approved' : 'draft'] },
    { key: 'note', label: labels.deliveryNote, w: 28, get: (r) => r.delivery_note_number ?? '—' },
    { key: 'station', label: labels.station, w: 30, get: (r) => r.station ?? '—' },
    { key: 'supplier', label: labels.supplier, w: 38, get: (r) => r.supplier ?? '—' },
    { key: 'product', label: labels.product, w: 24, get: (r) => r.product ?? '—' },
    { key: 'tank', label: labels.tank, w: 16, get: (r) => r.tank ?? '—' },
    { key: 'disp', label: labels.dispatched, w: 24, numeric: true, get: (r) => litersText(r.dispatched_liters) },
    { key: 'recv', label: labels.received, w: 24, numeric: true, get: (r) => litersText(r.received_liters) },
    { key: 'var', label: labels.variance, w: 20, numeric: true, get: (r) => litersText(r.transit_variance_liters) },
  ];
  if (financial) cols.push({ key: 'cost', label: labels.costCol, w: 26, numeric: true, get: (r) => (r.total_cost_minor === null || r.total_cost_minor === undefined ? '—' : minorText(r.total_cost_minor)) });
  const scale = TW / cols.reduce((sum, c) => sum + c.w, 0);
  cols.forEach((c) => { c.w *= scale; });
  const ordered = rtl ? cols : cols; // الترتيب المنطقي نفسه؛ التموضع يبدأ من الحافة الأولى حسب الاتجاه
  const xOf = (index: number) => {
    const before = ordered.slice(0, index).reduce((sum, c) => sum + c.w, 0);
    return rtl ? R - before : L + before;
  };

  let y = 10;
  const header = (continued: boolean) => {
    if (!continued) {
      filled(pdf, L, y, TW, 20, NAVY, 2);
      fitText(pdf, report.company.name ?? '—', rtl ? R - 4 : L + 4, y + 8, 150, { size: 13, bold: true, align: sa, color: [255, 255, 255] });
      const ids = [report.company.vat_number ? `${labels.vat}: ${report.company.vat_number}` : null, report.company.cr_number ? `${labels.cr}: ${report.company.cr_number}` : null].filter(Boolean).join('   ');
      if (ids) fitText(pdf, ids, rtl ? R - 4 : L + 4, y + 14, 150, { size: 7.5, align: sa, color: [203, 213, 225] });
      fitText(pdf, labels.title, rtl ? L + 4 : R - 4, y + 8, 100, { size: 13, bold: true, align: ea, color: [255, 255, 255] });
      fitText(pdf, financial ? labels.variantFinancial : labels.variantOperational, rtl ? L + 4 : R - 4, y + 14, 100, { size: 8, align: ea, color: [203, 213, 225] });
      y += 24;
      const applied = Object.entries(report.filters as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (applied.length > 0) {
        const summary = `${labels.filtersTitle}: ` + applied.map(([k, v]) => `${labels.filterLabels[k] ?? k}=${String(v)}`).join('  ·  ');
        fitText(pdf, summary, start, y, TW, { size: 7.5, color: [107, 114, 128], align: sa });
        y += 5;
      }
    }
    filled(pdf, L, y, TW, 7, [241, 245, 249]);
    ordered.forEach((c, i) => {
      const x = xOf(i);
      const anchor = c.numeric ? (rtl ? x - c.w + 1.5 : x + c.w - 1.5) : (rtl ? x - 1.5 : x + 1.5);
      fitText(pdf, c.label, anchor, y + 4.7, c.w - 3, { size: 7.5, bold: true, align: c.numeric ? ea : sa, color: NAVY });
    });
    y += 7;
  };

  header(false);
  const bottom = 210 - 18;
  if (report.rows.length === 0) text(pdf, labels.empty, (L + R) / 2, y + 10, { size: 10, align: 'center', color: [107, 114, 128] });
  report.rows.forEach((r, rowIndex) => {
    if (y + 6.4 > bottom) { pdf.addPage('a4', 'landscape'); y = 10; header(true); }
    if (rowIndex % 2 === 1) filled(pdf, L, y, TW, 6.4, [249, 250, 251]);
    ordered.forEach((c, i) => {
      const x = xOf(i);
      const anchor = c.numeric ? (rtl ? x - c.w + 1.5 : x + c.w - 1.5) : (rtl ? x - 1.5 : x + 1.5);
      fitText(pdf, c.get(r), anchor, y + 4.4, c.w - 3, { size: 7.5, align: c.numeric ? ea : sa });
    });
    line(pdf, L, y + 6.4, R, y + 6.4, [229, 231, 235]);
    y += 6.4;
  });

  if (y + 14 > bottom) { pdf.addPage('a4', 'landscape'); y = 10; }
  y += 3;
  filled(pdf, L, y, TW, 7.5, [226, 232, 240]);
  const totals = report.totals;
  const label = `${labels.total} — ${labels.count}: ${totals.count}`;
  fitText(pdf, label, start === R ? R - 1.5 : L + 1.5, y + 5, 90, { size: 8, bold: true, align: sa, color: NAVY });
  const idx = (key: string) => ordered.findIndex((c) => c.key === key);
  const put = (key: string, value: string) => {
    const i = idx(key); if (i < 0) return; const c = ordered[i]; const x = xOf(i);
    fitText(pdf, value, rtl ? x - c.w + 1.5 : x + c.w - 1.5, y + 5, c.w - 3, { size: 8, bold: true, align: ea, color: NAVY });
  };
  put('disp', litersText(totals.dispatched_liters)); put('recv', litersText(totals.received_liters)); put('var', litersText(totals.transit_variance_liters));
  if (financial) put('cost', minorText(totals.total_cost_minor ?? 0));
  y += 11;
  if (financial && (totals.uncosted_count ?? 0) > 0) { fitText(pdf, `${labels.uncosted}: ${totals.uncosted_count}`, start, y, TW, { size: 8, color: [180, 83, 9], align: sa }); y += 5; }
  if (report.truncated) fitText(pdf, labels.truncated, start, y, TW, { size: 8, color: [180, 83, 9], align: sa });

  footers(pdf, labels, report.generated_by, report.generated_at, report.variant === 'operational' ? labels.operationalNote : null, rtl);
  return pdf.output('blob');
}
