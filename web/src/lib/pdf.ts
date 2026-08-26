// توليد PDF من عنصر مستند HTML (html2canvas + jsPDF)، مع تنزيل ومشاركة كملف.
// المكتبتان تُستورَدان ديناميكياً فلا تُثقلان الحزمة الأساسية.
// العنصر مرئيّ على الشاشة (#print-root)؛ يُلتقَط في مكانه ويُقاس حسب حجم الورق.

/** أبعاد الورق بالمليمتر. heightMm ≤ 0 = ارتفاع مفتوح (إيصال حراري، صفحة واحدة). */
export interface PdfPaper {
  widthMm: number;
  heightMm: number;
}

const A4: PdfPaper = { widthMm: 210, heightMm: 297 };

type PdfImageSlice = { top: number; height: number };

/**
 * يقسم الصورة الطويلة إلى شرائح A4، مع تفضيل آخر حد آمن قبل نهاية الصفحة.
 * الحد الآمن يأتي من نهاية صف جدول أو نهاية قسم مستند؛ يبقى السقوط إلى الحد
 * الحسابي للكتل الأطول من صفحة، كي لا تتعطل المخرجات عند نص استثنائي طويل.
 */
export function getPdfImageSlices(
  imageHeight: number,
  pageHeight: number,
  safeBreaks: readonly number[],
): PdfImageSlice[] {
  const normalizedBreaks = [...new Set(safeBreaks)]
    .filter((point) => point > 0 && point < imageHeight)
    .sort((left, right) => left - right);
  const slices: PdfImageSlice[] = [];
  let top = 0;

  while (top < imageHeight) {
    const nominalEnd = Math.min(top + pageHeight, imageHeight);
    const candidate = normalizedBreaks.filter((point) => point > top && point <= nominalEnd).at(-1);
    const end = candidate && candidate - top >= Math.max(pageHeight * 0.25, 48) ? candidate : nominalEnd;
    slices.push({ top, height: end - top });
    top = end;
  }

  return slices;
}

function getSafeCanvasBreaks(el: HTMLElement, canvas: HTMLCanvasElement): number[] {
  const elementRect = el.getBoundingClientRect();
  const cssToCanvas = canvas.width / el.scrollWidth;
  const toCanvasY = (element: Element, edge: 'top' | 'bottom') => {
    const rect = element.getBoundingClientRect();
    return Math.round((rect[edge] - elementRect.top) * cssToCanvas);
  };

  const rowEnds = Array.from(el.querySelectorAll('tbody tr')).map((row) => toCanvasY(row, 'bottom'));
  const sectionEnds = Array.from(el.children).map((section) => toCanvasY(section, 'bottom'));
  return [...rowEnds, ...sectionEnds].filter((point) => point > 0 && point < canvas.height);
}

/**
 * بعض صفحات المستند تُبقي القالب الحقيقي في DOM لكنه مخفي إلى أن يطلب المستخدم
 * معاينته. نكشفه مؤقتاً كي يلتقطه المصدر نفسه في PDF، بدلاً من العودة إلى قالب
 * متجه موازٍ يختلف عن التصميم المنشور.
 */
function revealDocumentForCapture(element: HTMLElement, restore: Array<[HTMLElement, string | null]>): void {
  for (let current: HTMLElement | null = element; current && current !== document.body; current = current.parentElement) {
    const computed = window.getComputedStyle(current);
    if (computed.display !== 'none' && computed.visibility !== 'hidden') continue;
    restore.push([current, current.getAttribute('style')]);
    if (computed.display === 'none') current.style.setProperty('display', 'block', 'important');
    if (computed.visibility === 'hidden') current.style.setProperty('visibility', 'visible', 'important');
  }
}

async function elementToPdfBlob(el: HTMLElement, paper: PdfPaper = A4): Promise<Blob> {
  const [{ default: html2canvas }, jspdf] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const JsPDF = jspdf.jsPDF;

  // انتظار تحميل الخطوط (IBM Plex Sans Arabic) قبل الالتقاط — يمنع تشوّه تشكيل
  // العربية عند سقوط html2canvas إلى خطّ احتياطي لا يصل الحروف.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* تجاهل — نُكمل الالتقاط */
    }
  }

  // تحييد تصغير المعاينة (DocumentScaler) أثناء الالتقاط: html2canvas يقرأ العنصر
  // بحجمه المعروض المُصغَّر فيلتقطه مقصوصاً وبأبعاد خاطئة (صفحات كثيرة). نُلغي
  // التحويل مؤقّتاً فيُصوَّر بحجمه الطبيعي (210mm)، ثم نُعيد الحالة.
  const inner = el.closest<HTMLElement>('.doc-scaler-inner');
  const outer = el.closest<HTMLElement>('.doc-scaler-outer');
  const restore: Array<[HTMLElement, string | null]> = [];
  revealDocumentForCapture(el, restore);
  if (inner) {
    restore.push([inner, inner.getAttribute('style')]);
    inner.style.transform = 'none';
    inner.style.width = 'auto';
  }
  if (outer) {
    restore.push([outer, outer.getAttribute('style')]);
    outer.style.height = 'auto';
    outer.style.overflow = 'visible';
  }

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: el.scrollWidth,
    });
  } finally {
    for (const [node, style] of restore) {
      if (style === null) node.removeAttribute('style');
      else node.setAttribute('style', style);
    }
  }
  const img = canvas.toDataURL('image/png');
  const pw = paper.widthMm;
  const imgH = (canvas.height * pw) / canvas.width;

  // ارتفاع مفتوح (حراري): صفحة واحدة بمقاس المحتوى، بلا ترقيم صفحات.
  if (paper.heightMm <= 0) {
    const pdf = new JsPDF({ unit: 'mm', format: [pw, imgH], orientation: 'portrait' });
    pdf.addImage(img, 'PNG', 0, 0, pw, imgH);
    return pdf.output('blob');
  }

  // ورق ثابت (A4/Letter/Legal): نرسم كل صفحة من شريحة raster مستقلة. هذا
  // يحافظ على الناقل الحالي نفسه، لكنه يفضّل حدود صفوف البنود وكتل المستند
  // كي لا يمر فاصل A4 عبر صف أو إجماليات عند وجود مستند طويل.
  const ph = paper.heightMm;
  const pdf = new JsPDF({ unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait' });
  const pageHeightCanvas = (ph * canvas.width) / pw;
  const slices = getPdfImageSlices(canvas.height, pageHeightCanvas, getSafeCanvasBreaks(el, canvas));

  slices.forEach((slice, index) => {
    if (index > 0) pdf.addPage();
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = Math.ceil(slice.height);
    const context = pageCanvas.getContext('2d');
    if (!context) throw new Error('تعذر إنشاء سياق رسم صفحة PDF');
    context.drawImage(canvas, 0, slice.top, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    const pageHeightMm = (slice.height * pw) / canvas.width;
    pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pw, pageHeightMm);
  });
  return pdf.output('blob');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/** يولّد PDF من العنصر ويُنزّله (بحجم الورق المحدَّد أو A4). */
export async function downloadPdf(el: HTMLElement, filename: string, paper?: PdfPaper): Promise<void> {
  const blob = await elementToPdfBlob(el, paper);
  triggerDownload(blob, filename);
}

/**
 * يولّد PDF ويشاركه كملف عبر Web Share API (واتساب/بريد…).
 * يُعيد 'shared' عند النجاح، 'downloaded' عند عدم دعم مشاركة الملفات (تراجع للتنزيل).
 */
export async function sharePdf(el: HTMLElement, filename: string, title: string, paper?: PdfPaper): Promise<'shared' | 'downloaded'> {
  const blob = await elementToPdfBlob(el, paper);
  const name = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return 'shared';
  }
  triggerDownload(blob, name);
  return 'downloaded';
}
