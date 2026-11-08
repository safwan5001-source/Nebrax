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

/** px (96dpi) → mm. */
const MM_PER_PX = 25.4 / 96;
/** هامش تغذية صغير يمنع صفحة ثانية بسبب فرق تقريب بين قياس الشاشة وتخطيط الطباعة. */
const ROLL_FEED_MM = 2;
/** أدنى/أقصى ارتفاع لصفحة رول (الحد الأعلى دون حد صفحة Chromium ≈ 200 بوصة). */
const ROLL_MIN_HEIGHT_MM = 20;
const ROLL_MAX_HEIGHT_MM = 5000;
/** ارتفاع احتياطي إن تعذّر القياس (لا تخطيط، كالاختبارات)؛ آمن لا مُقتَطِع. */
const ROLL_FALLBACK_HEIGHT_MM = 297;

/**
 * ارتفاع جذر الإيصال بالمليمتر كما سيُطبع: يُقاس **نسخة** خارج أي تصغير/تكبير للمعاينة
 * (`DocumentScaler`، `.receipt-preview-zoom`) وخارج الأجداد المخفية (جذر الحراري
 * `#thermal-print-root` مخفي على الشاشة)، بعرض الورق نفسه. يعيد `null` عند تعذّر القياس.
 */
export function measureRollHeightMm(target: HTMLElement, widthMm: number): number | null {
  if (typeof document === 'undefined') return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;width:${widthMm}mm;`;
  const clone = target.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.removeAttribute('data-print-target');
  clone.style.display = 'block';
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const heightPx = clone.getBoundingClientRect().height;
    return heightPx > 0 ? heightPx * MM_PER_PX : null;
  } finally {
    host.remove();
  }
}

/**
 * CSS صفحة الطباعة لمقاس ورق معيّن.
 *  • ورق ثابت (A4/Letter/Legal): `size: Wmm Hmm` كما كان.
 *  • رول حراري (heightMm ≤ 0): `size: Wmm Hmm` **بارتفاع المحتوى**. كان الإعلان السابق
 *    `size: Wmm auto` غير صالح وفق CSS Paged Media (أطوال فقط) فيُسقطه Chromium ويبقى A4
 *    العام. الهامش صفر لأن القالب الحراري يحمل حشوه الداخلي؛ هامش 4mm كان يضيّق المساحة
 *    المطبوعة فيُصغَّر الإيصال. ويُقيَّد ارتفاع html/body بارتفاع الصفحة (أثناء الطباعة فقط)
 *    كي لا تنتج بقية عناصر الصفحة المخفية بصرياً صفحات رول إضافية فارغة.
 */
export function buildPrintPageCss(paper: PdfPaper, contentHeightMm?: number | null): string {
  if (paper.heightMm > 0) {
    return `@media print { @page { size: ${paper.widthMm}mm ${paper.heightMm}mm; } }`;
  }
  const measured = contentHeightMm && contentHeightMm > 0
    ? Math.ceil(contentHeightMm) + ROLL_FEED_MM
    : ROLL_FALLBACK_HEIGHT_MM;
  const height = Math.min(ROLL_MAX_HEIGHT_MM, Math.max(ROLL_MIN_HEIGHT_MM, measured));
  return [
    '@media print {',
    `  @page { size: ${paper.widthMm}mm ${height}mm; margin: 0; }`,
    `  html, body { height: ${height}mm !important; max-height: ${height}mm !important; overflow: hidden !important; }`,
    '}',
  ].join('\n');
}

/**
 * طباعة عبر المتصفح (نفس القالب المرئي). عند تمرير حجم ورق يُحقن `@page` مؤقّتاً
 * ليطبع بالمقاس الصحيح (A4 أو 58/80mm حراري بارتفاع المحتوى).
 */
export function printDocument(paper?: PdfPaper, targetId = 'print-root'): void {
  if (typeof window === 'undefined') return;

  // لا تطبع العملية إلا الجذر المطلوب؛ تتناوب معاينة A4 والإيصال الحراري في
  // الصفحة نفسها، ولذلك لا يكفي الاعتماد على معرّف ثابت واحد.
  document.querySelectorAll('[data-print-target]').forEach((element) => {
    element.removeAttribute('data-print-target');
  });
  const target = document.getElementById(targetId);
  if (!target) return;
  target.setAttribute('data-print-target', '');

  document.getElementById(PRINT_PAGE_STYLE_ID)?.remove();
  if (paper) {
    const style = document.createElement('style');
    style.id = PRINT_PAGE_STYLE_ID;
    style.textContent = buildPrintPageCss(paper, paper.heightMm > 0 ? null : measureRollHeightMm(target, paper.widthMm));
    document.head.appendChild(style);
  }
  window.addEventListener('afterprint', () => {
    target.removeAttribute('data-print-target');
    document.getElementById(PRINT_PAGE_STYLE_ID)?.remove();
  }, { once: true });
  window.print();
}
