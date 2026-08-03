import { downloadPdf, sharePdf } from '@/lib/pdf';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Export Adapter — واجهة تصدير المستند
 * ═══════════════════════════════════════════════════════════════════════════
 *  المكوّنات والصفحات تعتمد على هذه الواجهة فقط، لا على مكتبة بعينها. القالب
 *  يُرسَم مرّة واحدة (شاشة = طباعة = PDF)، والتنفيذ الحالي (html2canvas+jsPDF)
 *  يقبع خلف الواجهة فيمكن استبداله لاحقاً (react-pdf/Puppeteer/SSR) دون تعديل
 *  أي مكوّن فاتورة.
 */
export interface DocumentExportTarget {
  /** العنصر المرئي المُلتقَط (جذر المستند، عادةً #print-root). */
  element: HTMLElement;
  fileName: string;
  title?: string;
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
  download: ({ element, fileName }) => downloadPdf(element, fileName),
  share: ({ element, fileName, title }) => sharePdf(element, fileName, title ?? fileName),
};

/** المُصدِّر المستخدَم حالياً — نقطة تبديل وحيدة مستقبلاً. */
export const documentExporter: DocumentExporter = html2canvasExporter;

/** طباعة عبر المتصفح (نفس القالب المرئي، معزولاً بـ @media print). */
export function printDocument(): void {
  if (typeof window !== 'undefined') window.print();
}
