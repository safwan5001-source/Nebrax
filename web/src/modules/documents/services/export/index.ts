import { downloadPdf, sharePdf, type PdfPaper } from '@/lib/pdf';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Export Adapter — واجهة تصدير المستند
 * ═══════════════════════════════════════════════════════════════════════════
 *  المكوّنات والصفحات تعتمد على هذه الواجهة فقط، لا على مكتبة بعينها. القالب
 *  يُرسَم مرّة واحدة (شاشة = طباعة = PDF)، والتنفيذ الحالي (html2canvas+jsPDF)
 *  يقبع خلف الواجهة فيمكن استبداله لاحقاً (react-pdf/Puppeteer/SSR) دون تعديل
 *  أي مكوّن فاتورة. حجم الورق يُمرَّر فيتكيّف الـ PDF والطباعة (A4…حراري).
 */
export interface DocumentExportTarget {
  /** العنصر المرئي المُلتقَط (جذر المستند، عادةً #print-root). */
  element: HTMLElement;
  fileName: string;
  title?: string;
  /** أبعاد الورق (مليمتر)؛ الافتراضي A4. */
  paper?: PdfPaper;
}

export interface DocumentExporter {
  readonly id: string;
  download(target: DocumentExportTarget): Promise<void>;
  /** يُعيد 'shared' عند نجاح المشاركة، أو 'downloaded' عند التراجع للتنزيل. */
  share(target: DocumentExportTarget): Promise<'shared' | 'downloaded'>;
}

/** التنفيذ الافتراضي: التقاط الـ DOM المرئي (أفضل دقّة للعربية/RTL). */
export const html2canvasExporter: DocumentExporter = {
  id: 'html2canvas',
  download: ({ element, fileName, paper }) => downloadPdf(element, fileName, paper),
  share: ({ element, fileName, title, paper }) => sharePdf(element, fileName, title ?? fileName, paper),
};

/** المُصدِّر المستخدَم حالياً — نقطة تبديل وحيدة مستقبلاً. */
export const documentExporter: DocumentExporter = html2canvasExporter;

const PRINT_PAGE_STYLE_ID = 'nebrax-doc-print-page';

/**
 * طباعة عبر المتصفح (نفس القالب المرئي). عند تمرير حجم ورق يُحقن `@page` مؤقّتاً
 * ليطبع بالمقاس الصحيح (A4 أو 58/80mm حراري بارتفاع مفتوح).
 */
export function printDocument(paper?: PdfPaper): void {
  if (typeof window === 'undefined') return;
  document.getElementById(PRINT_PAGE_STYLE_ID)?.remove();
  if (paper) {
    const style = document.createElement('style');
    style.id = PRINT_PAGE_STYLE_ID;
    style.textContent =
      paper.heightMm > 0
        ? `@media print { @page { size: ${paper.widthMm}mm ${paper.heightMm}mm; } }`
        : `@media print { @page { size: ${paper.widthMm}mm auto; margin: 4mm; } }`;
    document.head.appendChild(style);
  }
  window.print();
}
