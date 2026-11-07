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

/** تسامح التقريب بالبكسل: ما زاد عن الصفحة بهذا القدر لا يستحق صفحة جديدة. */
const PAGE_FIT_TOLERANCE_PX = 2;
/** أصغر ذيل مقبول (نسبة من ارتفاع الصفحة) حين يُختار قطع مبكّر لتفادي صفحة أخيرة هزيلة. */
const MIN_TAIL_RATIO = 0.1;
/** هامش أمان أسفل آخر حبر عند قصّ الفراغ الختامي (بكسل كانفاس). */
const CONTENT_BOTTOM_PAD_PX = 16;
/** القناة التي تُعدّ فوقها البكسل «بياضاً» عند البحث عن آخر حبر. */
const BLANK_CHANNEL_MIN = 250;

/**
 * يقسم الصورة الطويلة إلى شرائح بحجم الصفحة، مع تفضيل آخر حد آمن قبل نهاية الصفحة.
 * الحد الآمن يأتي من نهاية صف جدول أو نهاية قسم مستند؛ يبقى السقوط إلى الحد
 * الحسابي للكتل الأطول من صفحة، كي لا تتعطل المخرجات عند نص استثنائي طويل.
 *
 * قاعدتان تمنعان الصفحات اليتيمة (AWJ-DOC-V2-PR1):
 *  1) ما بقي من المحتوى إن اتّسع في صفحة واحدة يُؤخذ كاملاً — لا يُقطع عند آخر حد آمن
 *     (كان ذلك يترك التذييل وحده في صفحة جديدة).
 *  2) عند الحاجة لقطع، يُفضَّل أقرب حد آمن يترك ذيلاً لا يقل عن `MIN_TAIL_RATIO` من الصفحة
 *     (فتنتقل كتلة الإجماليات مع التذييل معاً بدل سطر تذييل يتيم)، وإن لم يوجد حد كهذا
 *     يُستعمل آخر حد آمن كما كان.
 */
export function getPdfImageSlices(
  imageHeight: number,
  pageHeight: number,
  safeBreaks: readonly number[],
): PdfImageSlice[] {
  const normalizedBreaks = [...new Set(safeBreaks)]
    .filter((point) => point > 0 && point < imageHeight)
    .sort((left, right) => left - right);
  const minSlice = Math.max(pageHeight * 0.25, 48);
  const minTail = Math.max(pageHeight * MIN_TAIL_RATIO, 48);
  const slices: PdfImageSlice[] = [];
  let top = 0;

  while (top < imageHeight) {
    if (imageHeight - top <= pageHeight + PAGE_FIT_TOLERANCE_PX) {
      slices.push({ top, height: imageHeight - top });
      break;
    }

    const nominalEnd = top + pageHeight;
    const candidates = normalizedBreaks
      .filter((point) => point > top && point <= nominalEnd && point - top >= minSlice)
      .sort((left, right) => right - left);
    const balanced = candidates.find((point) => {
      const tail = imageHeight - point;
      return tail >= minTail;
    });
    const end = balanced ?? candidates[0] ?? nominalEnd;
    slices.push({ top, height: end - top });
    top = end;
  }

  return slices;
}

/**
 * آخر صف يحوي حبراً (غير أبيض) داخل مصفوفة RGBA، أو -1 إن كانت كلها بيضاء.
 * دالة نقيّة للاختبار؛ `findContentHeight` تطبّقها على الكانفاس الحقيقي.
 */
export function findLastInkRow(data: ArrayLike<number>, width: number, rows: number): number {
  for (let row = rows - 1; row >= 0; row -= 1) {
    const base = row * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = base + x * 4;
      if (data[i + 3] > 0 && (data[i] < BLANK_CHANNEL_MIN || data[i + 1] < BLANK_CHANNEL_MIN || data[i + 2] < BLANK_CHANNEL_MIN)) return row;
    }
  }
  return -1;
}

/**
 * ارتفاع المحتوى الفعلي بالكانفاس بعد قصّ الفراغ الأبيض الختامي (ينشأ من الارتفاع الأدنى
 * للمستند والتذييل المثبَّت للأسفل). يعيد الارتفاع الكامل إن تعذّرت القراءة.
 */
export function findContentHeight(canvas: HTMLCanvasElement): number {
  if (typeof canvas.getContext !== 'function') return canvas.height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return canvas.height;
    const strip = 64;
    for (let bottom = canvas.height; bottom > 0; bottom -= strip) {
      const top = Math.max(0, bottom - strip);
      const rows = bottom - top;
      const { data } = context.getImageData(0, top, canvas.width, rows);
      const last = findLastInkRow(data, canvas.width, rows);
      if (last >= 0) return Math.min(canvas.height, top + last + 1 + CONTENT_BOTTOM_PAD_PX);
    }
  } catch {
    /* كانفاس ملوّث أو سياق غير متاح — نُبقي الارتفاع الكامل */
  }
  return canvas.height;
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

/** مصدر صور صفحات PDF: كانفاس حقيقي في المتصفح، أو بديل نقيّ في الاختبارات. */
export interface PdfRaster {
  width: number;
  height: number;
  /** PNG (data URL) للصفوف [top, top+height). */
  slicePng(top: number, height: number): string;
}

export function canvasRaster(canvas: HTMLCanvasElement): PdfRaster {
  return {
    width: canvas.width,
    height: canvas.height,
    slicePng(top, height) {
      if (top === 0 && height >= canvas.height) return canvas.toDataURL('image/png');
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = Math.ceil(height);
      const context = pageCanvas.getContext('2d');
      if (!context) throw new Error('تعذر إنشاء سياق رسم صفحة PDF');
      context.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);
      return pageCanvas.toDataURL('image/png');
    },
  };
}

type JsPdfConstructor = typeof import('jspdf').jsPDF;

/**
 * يجمّع ملف PDF من صورة المستند. `compress: true` يضغط الصور بلا فقد (Flate + مرشّح PNG) —
 * بدونه يخزّن jsPDF البكسلات خاماً (≈5.6 MB لكل صفحة A4 بدقة scale:2).
 * ليس ذلك علاجاً لغياب طبقة النص: الملف يبقى صورة (انظر تقرير DOC-P0-1).
 */
export function buildPdfBlob(
  JsPdf: JsPdfConstructor,
  raster: PdfRaster,
  paper: PdfPaper,
  safeBreaks: readonly number[],
  contentHeight: number = raster.height,
): Blob {
  const pw = paper.widthMm;

  // ارتفاع مفتوح (حراري): صفحة واحدة بمقاس المحتوى، بلا ترقيم صفحات.
  if (paper.heightMm <= 0) {
    const imgH = (raster.height * pw) / raster.width;
    const pdf = new JsPdf({ unit: 'mm', format: [pw, imgH], orientation: 'portrait', compress: true });
    pdf.addImage(raster.slicePng(0, raster.height), 'PNG', 0, 0, pw, imgH);
    return pdf.output('blob');
  }

  // ورق ثابت (A4/Letter/Legal): إذا اتّسع المحتوى في صفحة واحدة يُرسَم كاملاً بلا تقطيع،
  // وإلا يُقطَّع لشرائح بحدود آمنة عند صفوف الجدول وكتل المستند (انظر getPdfImageSlices).
  const ph = paper.heightMm;
  const pdf = new JsPdf({ unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait', compress: true });
  const pageHeightPx = (ph * raster.width) / pw;
  const content = Math.min(raster.height, Math.max(1, Math.ceil(contentHeight)));

  getPdfImageSlices(content, pageHeightPx, safeBreaks).forEach((slice, index) => {
    if (index > 0) pdf.addPage();
    pdf.addImage(raster.slicePng(slice.top, slice.height), 'PNG', 0, 0, pw, (slice.height * pw) / raster.width);
  });
  return pdf.output('blob');
}

async function elementToPdfBlob(el: HTMLElement, paper: PdfPaper = A4): Promise<Blob> {
  const [{ default: html2canvas }, jspdf] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

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
  let safeBreaks: number[] = [];
  try {
    canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: el.scrollWidth,
      // طبقة توافق العربية على نسخة الالتقاط وحدها — لا تمسّ المستند الحيّ.
      onclone: (_clonedDoc, clonedEl) => normalizePdfCloneForArabic(clonedEl),
    });
    // الحدود الآمنة تُقاس والتحييد ما زال فعّالاً (قبل الاستعادة). قياسها بعد إعادة
    // تحويل التصغير (DocumentScaler) على الجوال كان يُنتج إحداثيات مصغَّرة فتُقطع الصفوف
    // وتختلف أعداد الصفحات بين سطح المكتب والجوال.
    safeBreaks = getSafeCanvasBreaks(el, canvas);
  } finally {
    for (const [node, style] of restore) {
      if (style === null) node.removeAttribute('style');
      else node.setAttribute('style', style);
    }
  }
  // الحراري (ارتفاع مفتوح) يبقى بكامل ارتفاع الالتقاط؛ ورق الصفحات الثابت يُقصّ فراغه الختامي.
  const contentHeight = paper.heightMm > 0 ? findContentHeight(canvas) : canvas.height;
  return buildPdfBlob(jspdf.jsPDF, canvasRaster(canvas), paper, safeBreaks, contentHeight);
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
