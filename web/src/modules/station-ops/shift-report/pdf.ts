import { filled, fitLines, fitText, line, newPdf, text, textWidth, wrapLines, type PdfDoc } from '../receiving/documents/pdf-kit';
import type { Cell, KvRow, ReportSection, ShiftReportModel, TableColumn } from './model';

/**
 * AWJ-DOC-V2-PR7 — رسم PDF متجه لتقرير إغلاق وتسليم الوردية (jsPDF + أدوات `pdf-kit` القائمة، نص حقيقي قابل للاستخراج).
 * يقرأ **النموذج وحده** (`model.ts`)؛ لا يحسب شيئاً ولا يطلب شبكة. A4 عمودي (تفصيلي) وA5 أفقي (مختصر).
 * لا قصّ ولا تداخل: القيم الطويلة تُصغَّر ثم تُلَفّ، وصفوف الجداول تنساب إلى صفحة تالية بترويسة جدول مكرَّرة، وكتلة التوقيع لا تنقسم.
 */

const NAVY: [number, number, number] = [15, 39, 72];
const MUTED: [number, number, number] = [107, 114, 128];
const SOFT: [number, number, number] = [241, 245, 249];
const AMBER: [number, number, number] = [146, 64, 14];
const INK: [number, number, number] = [17, 24, 39];

interface Geometry { W: number; H: number; M: number; bottom: number; orientation: 'portrait' | 'landscape'; format: 'a4' | 'a5'; compact: boolean }
const GEOMETRY: Record<'a4' | 'a5', Geometry> = {
  a4: { W: 210, H: 297, M: 12, bottom: 279, orientation: 'portrait', format: 'a4', compact: false },
  a5: { W: 210, H: 148, M: 8, bottom: 131, orientation: 'landscape', format: 'a5', compact: true },
};

export async function createShiftReportPdf(model: ShiftReportModel, locale: string): Promise<Blob> {
  const g = GEOMETRY[model.paper];
  const pdf = await newPdf(g.orientation, g.format);
  const rtl = locale.startsWith('ar');
  const L = g.M;
  const R = g.W - g.M;
  const sa: 'left' | 'right' = rtl ? 'right' : 'left';
  const ea: 'left' | 'right' = rtl ? 'left' : 'right';
  const start = rtl ? R : L;
  const sizes = g.compact ? { label: 7, value: 8.5, head: 8.5, row: 8, title: 12 } : { label: 7.5, value: 9, head: 9.5, row: 8.5, title: 14 };
  let y = g.M;

  // ───── ترويسة ─────
  const header = () => {
    const bandH = g.compact ? 15.5 : 22;
    filled(pdf, L, y, R - L, bandH, NAVY, 2);
    const s = rtl ? R - 4 : L + 4;
    const e = rtl ? L + 4 : R - 4;
    fitText(pdf, model.company.name, s, y + (g.compact ? 6.8 : 8.5), 105, { size: g.compact ? 13 : 15, bold: true, align: sa, color: [255, 255, 255] });
    const ids = [model.company.vat ? `${model.labels.vat}: ${model.company.vat}` : null, model.company.cr ? `${model.labels.cr}: ${model.company.cr}` : null].filter(Boolean).join('   ');
    if (ids) fitText(pdf, ids, s, y + (g.compact ? 11.2 : 15), 105, { size: 7, align: sa, color: [203, 213, 225] });
    fitText(pdf, model.title, e, y + (g.compact ? 5.8 : 8), 80, { size: g.compact ? 12 : 13, bold: true, align: ea, color: [255, 255, 255] });
    fitText(pdf, `${model.variantLabel} — ${model.status.label}`, e, y + (g.compact ? 10.4 : 14.5), 80, { size: 8, align: ea, color: [203, 213, 225] });
    y += bandH + 4;
  };
  const continuation = () => {
    filled(pdf, L, y, R - L, 8, NAVY, 1.5);
    fitText(pdf, model.company.name, rtl ? R - 3 : L + 3, y + 5.4, 100, { size: 9, bold: true, align: sa, color: [255, 255, 255] });
    fitText(pdf, model.title, rtl ? L + 3 : R - 3, y + 5.4, 80, { size: 8, align: ea, color: [203, 213, 225] });
    y += 13;
  };
  header();

  const ensure = (height: number) => {
    if (y + height <= g.bottom) return false;
    pdf.addPage(g.format, g.orientation);
    y = g.M;
    continuation();
    return true;
  };

  const GAP = 4;
  const colEdges = (index: number, count: number) => {
    const colW = (R - L - (count - 1) * GAP) / count;
    const x0 = rtl ? R - index * (colW + GAP) : L + index * (colW + GAP);
    return { x0, x1: rtl ? x0 - colW : x0 + colW, colW };
  };
  const cellColor = (cell: Cell): [number, number, number] => (cell.na ? MUTED : INK);

  /** `keep`: ارتفاع أول محتوى يلزم أن يبقى مع العنوان في الصفحة نفسها (لا عنوان قسم يتيم أسفل صفحة). */
  const sectionTitle = (title: string, keep = 9) => {
    ensure(5.8 + keep);
    filled(pdf, L, y - 3.4, R - L, 5.4, SOFT, 1);
    text(pdf, title, start, y + 0.3, { size: sizes.head, bold: true, color: NAVY, align: sa });
    y += 5.8;
  };

  const lineCount = (value: string, width: number, size: number, bold: boolean): number => {
    let s = size;
    while (s > 6.5 && textWidth(pdf, value, s, bold) > width) s -= 0.5;
    if (textWidth(pdf, value, s, bold) <= width) return 1;
    return Math.min(4, wrapLines(pdf, value, width, size, bold).length);
  };

  // ───── قيم بعنوان فوق قيمة ─────
  const kv = (section: Extract<ReportSection, { kind: 'kv' }>) => {
    if (section.title) sectionTitle(section.title);
    const n = section.columns;
    const rows = section.rows;
    for (let r = 0; r < rows.length; r += n) {
      const chunk: KvRow[] = rows.slice(r, r + n);
      const counts = chunk.map((row, i) => lineCount(row.value.text, colEdges(i, n).colW, sizes.value, true));
      const rowH = (g.compact ? 8 : 9.4) + (Math.max(...counts) - 1) * 3.6;
      ensure(rowH + 1);
      chunk.forEach((row, i) => {
        const { x0, x1, colW } = colEdges(i, n);
        text(pdf, row.label, x0, y, { size: sizes.label, color: MUTED, align: sa, maxWidth: colW });
        fitLines(pdf, row.value.text, x0, y + 4.2, colW, { size: sizes.value, bold: row.value.strong === true || !row.value.na, align: sa, color: cellColor(row.value) }, 4);
        line(pdf, Math.min(x0, x1), y + rowH - 3, Math.max(x0, x1), y + rowH - 3);
      });
      y += rowH;
    }
    y += 2;
  };

  // ───── جدول: ترويسة مكرَّرة وصفوف منسابة ─────
  const table = (section: Extract<ReportSection, { kind: 'table' }>) => {
    sectionTitle(section.title, 5.2 + 5.6);
    const cols: TableColumn[] = section.columns;
    const weights = cols.map((c) => (c.align === 'end' ? 2 : 3.2));
    const sum = weights.reduce((a, b) => a + b, 0);
    const width = R - L;
    const widths = weights.map((w) => (w / sum) * width);
    // الحدود اليسرى لكل عمود بحسب الاتجاه (العمود الأول عند بداية السطر).
    const lefts: number[] = [];
    let cursor = L;
    const order = rtl ? [...widths.keys()].reverse() : [...widths.keys()];
    const leftOf = new Map<number, number>();
    for (const idx of order) { leftOf.set(idx, cursor); cursor += widths[idx]; }
    cols.forEach((_, i) => lefts.push(leftOf.get(i) as number));

    const drawCell = (cell: Cell, i: number, yy: number, bold: boolean, size: number): number => {
      const pad = 1.6;
      const left = lefts[i] + pad;
      const right = lefts[i] + widths[i] - pad;
      const col = cols[i];
      const toRight = col.align === 'end' || rtl;
      const x = toRight ? right : left;
      const align: 'left' | 'right' = toRight ? 'right' : 'left';
      return fitLines(pdf, cell.text, x, yy, right - left, { size, bold: bold || cell.strong === true, align, color: cellColor(cell) }, 3, 3.4, 6);
    };
    const headerRow = () => {
      ensure(7);
      filled(pdf, L, y - 3.2, R - L, 5.2, SOFT);
      cols.forEach((col, i) => {
        const pad = 1.6;
        const toRight = col.align === 'end' || rtl;
        text(pdf, col.label, toRight ? lefts[i] + widths[i] - pad : lefts[i] + pad, y + 0.2, { size: 7, bold: true, color: MUTED, align: toRight ? 'right' : 'left', maxWidth: widths[i] - 2 * pad });
      });
      y += 5.2;
    };
    const rowHeight = (cells: Cell[], bold: boolean): number => {
      const counts = cells.map((cell, i) => lineCount(cell.text, widths[i] - 3.2, sizes.row, bold || cell.strong === true));
      return 4.6 + (Math.max(...counts) - 1) * 3.4;
    };

    headerRow();
    if (section.rows.length === 0) {
      text(pdf, '—', start, y, { size: sizes.row, color: MUTED, align: sa });
      y += 5;
    }
    section.rows.forEach((cells) => {
      const h = rowHeight(cells, false);
      if (ensure(h + 1)) headerRow();
      cells.forEach((cell, i) => drawCell(cell, i, y, false, sizes.row));
      line(pdf, L, y + h - 2.6, R, y + h - 2.6);
      y += h;
    });
    if (section.totals) {
      const h = rowHeight(section.totals, true);
      if (ensure(h + 1)) headerRow();
      line(pdf, L, y - 3.2, R, y - 3.2, NAVY, 0.4);
      section.totals.forEach((cell, i) => drawCell(cell, i, y, true, sizes.row));
      y += h;
    }
    y += 2;
  };

  // ───── ملاحظة ─────
  const note = (section: Extract<ReportSection, { kind: 'note' }>) => {
    const size = g.compact ? 7.5 : 8;
    const lines = wrapLines(pdf, section.text, R - L - 2, size);
    ensure(lines.length * 3.8 + 1.5);
    lines.forEach((content) => { text(pdf, content, start, y, { size, color: section.tone === 'warning' ? AMBER : MUTED, align: sa }); y += 3.8; });
    y += 1.2;
  };

  // ───── التوقيعات: كتلة لا تنقسم ─────
  const signatures = (section: Extract<ReportSection, { kind: 'signatures' }>) => {
    // المختصر (A5): الاسم والوقت في سطر واحد فتتّسع الكتلة أسفل الصفحة الأولى حين يسمح ما فوقها؛ وإلا تنتقل كاملة (لا تنقسم ولا تُقصّ).
    const blockH = g.compact ? 16 : 24;
    ensure(blockH + 8);
    sectionTitle(section.title, 1);
    y = Math.max(y + 1, g.bottom - (g.compact ? 15.8 : 26));
    const n = section.cells.length;
    const sigW = (R - L - (n - 1) * 6) / n;
    section.cells.forEach((cell, i) => {
      const x0 = rtl ? R - i * (sigW + 6) : L + i * (sigW + 6);
      const xl = rtl ? x0 - sigW : x0;
      const cx = x0 + (rtl ? -sigW / 2 : sigW / 2);
      text(pdf, cell.role, cx, y, { size: 8, bold: true, align: 'center', color: NAVY, maxWidth: sigW });
      if (g.compact) {
        const who = [cell.name?.text, cell.when].filter(Boolean).join('  ·  ');
        if (who) fitText(pdf, who, cx, y + 4.2, sigW - 2, { size: 8, align: 'center', color: cell.name ? cellColor(cell.name) : MUTED });
      } else {
        if (cell.name) fitText(pdf, cell.name.text, cx, y + 4.4, sigW - 2, { size: 8.5, align: 'center', color: cellColor(cell.name) });
        if (cell.when) text(pdf, cell.when, cx, y + 8.2, { size: 7, align: 'center', color: MUTED });
      }
      line(pdf, xl, y + (g.compact ? 10 : 17), xl + sigW, y + (g.compact ? 10 : 17), MUTED, 0.3);
      text(pdf, model.labels.signature, cx, y + (g.compact ? 13.4 : 20.4), { size: 7, align: 'center', color: MUTED });
    });
    y += g.compact ? 15 : 24;
  };

  for (const section of model.sections) {
    if (section.kind === 'kv') kv(section);
    else if (section.kind === 'table') table(section);
    else if (section.kind === 'note') note(section);
    else signatures(section);
  }

  footers(pdf, model, g, rtl);
  return pdf.output('blob');
}

function footers(pdf: PdfDoc, model: ShiftReportModel, g: Geometry, rtl: boolean): void {
  const pages = pdf.getNumberOfPages();
  const L = g.M;
  const R = g.W - g.M;
  const base = g.H - (g.compact ? 14 : 12);
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    line(pdf, L, base, R, base);
    fitText(pdf, `${model.labels.generatedAt}: ${model.generatedAt}   ·   ${model.company.name}`, rtl ? R : L, base + 4.2, R - L - 30, { size: 7, color: MUTED, align: rtl ? 'right' : 'left' });
    text(pdf, `${model.labels.page} ${page} / ${pages}`, rtl ? L : R, base + 4.2, { size: 7, color: MUTED, align: rtl ? 'left' : 'right' });
  }
}
