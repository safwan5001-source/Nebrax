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
 * نطاقات الحرف العربي (وأشكاله التقديمية) — العلّة في html2canvas تخصّ النص المتصل
 * العربي وحده، فنقصر التطبيع عليه كي تبقى اللاتينية مطابقةً تماماً للمعاينة/الطباعة.
 */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** هل يحمل العنصر عقدة نصّ مباشرة غير فارغة تتضمّن حرفاً عربياً؟ (عنصر نصّ عربي طرفي) */
export function hasDirectArabicText(el: Element): boolean {
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = node.textContent ?? '';
      if (text.trim() !== '' && ARABIC_SCRIPT.test(text)) return true;
    }
  }
  return false;
}

/**
 * طبقة توافق تصدير PDF لـ AWJ — تُطبَّق على النسخة المؤقتة التي يبنيها html2canvas
 * (عبر `onclone`) وحدها، فلا تمسّ المستند الحيّ: المعاينة والطباعة تبقيان طبق
 * تصميمهما. تعالج عيبين مؤكَّدين في html2canvas مع النص العربي المتصل:
 *
 *  RC1 — أي `letter-spacing` غير `normal` يجعل html2canvas يرسم النص حرفاً حرفاً
 *        (segmentGraphemes) من اليسار لليمين، فيكسر التشكيل السياقي للعربية ويعكس
 *        ترتيبها. نُعيد التباعد إلى `normal` في النسخة فقط.
 *  RC2 — `overflow:hidden` أو `-webkit-line-clamp` أو `max-height` المُقيِّد يقصّ
 *        صعود ونزول الحروف العربية خطأً (html2canvas يحسب صندوق القص أضيق من
 *        المتصفح). نُبطله على عناصر النصّ العربية الطرفية فقط، لا حاويات التخطيط.
 *
 * القاعدة عامّة على مستوى محرّك التصدير: **أي** مستند AWJ يمرّ عبر هذا المسار يرث
 * الحماية تلقائياً — بلا اعتماد على معرّف قالب أو نوع مستند أو محدِّد خاص بأي وثيقة،
 * فتشمل المستندات الحالية والمستقبلية دون ترقيع إضافي. والتمييز دلاليّ: يُقصر التطبيع
 * على النصّ العربي (مصدر العلّة وحده) فتبقى اللاتينية مطابقةً للمعاينة، ويُشترط في RC2
 * وجود عقدة نصّ عربية مباشرة فلا تُبطَل حاويات القص البنيوية (جداول، إجماليات،
 * شعار/رمز QR، أغلفة التخطيط) لأنها لا تحمل نصاً عربياً مباشراً.
 */
export function normalizePdfCloneForArabic(root: HTMLElement): void {
  const view = root.ownerDocument.defaultView;
  if (!view) return;
  // ملاحظة: لا نستعمل `instanceof HTMLElement` للحَرس — عناصر النسخة تعيش في إطار
  // html2canvas، فيفشل الفحص عبر النوافذ (cross-realm) ويُعطّل التطبيع كله بصمت.
  // كل عناصر `*` تملك `style` ويعمل عليها getComputedStyle، فالعمليات آمنة بلا حَرس.
  const elements: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const el of elements) {
    const cs = view.getComputedStyle(el);

    // RC1: تباعد الأحرف — على النصّ العربي فقط (اللاتينية تُصيَّر سليمة مع التباعد،
    // فنُبقيها مطابقةً للمعاينة). `textContent` يشمل الأبناء لأن التباعد يورَّث.
    const hasNonNormalSpacing = !!cs.letterSpacing && cs.letterSpacing !== 'normal' && parseFloat(cs.letterSpacing) !== 0;
    if (hasNonNormalSpacing && ARABIC_SCRIPT.test(el.textContent ?? '')) {
      el.style.letterSpacing = 'normal';
    }

    // RC2: القص — على عناصر النصّ العربية الطرفية وحدها، فلا تُمسّ حاويات التخطيط.
    if (hasDirectArabicText(el)) {
      const lineClamp = cs.getPropertyValue('-webkit-line-clamp');
      const clipsOverflow = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowY === 'hidden';
      const clamps = lineClamp !== '' && lineClamp !== 'none';
      const boundedHeight = cs.maxHeight !== 'none' && cs.maxHeight !== '' && cs.maxHeight !== '0px';
      if (clipsOverflow || clamps || boundedHeight) {
        el.style.overflow = 'visible';
        el.style.maxHeight = 'none';
        // فكّ display:-webkit-box المرافق لـ line-clamp حتى لا يبقى القص فعّالاً.
        if (cs.display === '-webkit-box') el.style.display = 'block';
        el.style.setProperty('-webkit-line-clamp', 'unset');
      }
    }
  }
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

  // تحييد خصائص العرض فقط التي تتحيّد عند الطباعة (print:min-h-0 print:shadow-none)
  // لكن html2canvas لا يطبّق @media print فتبقى فعّالة بدون هذا التحييد الصريح.
  // min-h يمنع المحتوى القصير من الانكماش فيُنتج صورة أطول من A4.
  // shadow يُلتقَط كبكسلات إضافية تدفع الصورة فوق الحد.
  restore.push([el, el.getAttribute('style')]);
  el.style.minHeight = 'auto';
  el.style.boxShadow = 'none';

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
      // طبقة توافق العربية على نسخة الالتقاط وحدها — لا تمسّ المستند الحيّ.
      onclone: (_clonedDoc, clonedEl) => normalizePdfCloneForArabic(clonedEl),
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

  // ورق ثابت (A4/Letter/Legal): إذا اتّسع المحتوى في صفحة واحدة يُرسَم كاملاً
  // بلا تقطيع (تحسين للفواتير القصيرة ومنع صفحات زائدة من أخطاء تقريب بكسل).
  // وإلا يُقطَّع لشرائح بحدود آمنة عند صفوف الجدول وكتل المستند.
  const ph = paper.heightMm;
  const pdf = new JsPDF({ unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait' });
  const pageHeightCanvas = (ph * canvas.width) / pw;

  if (canvas.height <= pageHeightCanvas) {
    pdf.addImage(img, 'PNG', 0, 0, pw, imgH);
    return pdf.output('blob');
  }

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
