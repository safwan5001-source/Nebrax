/**
 * FUEL-B5.1 — أدوات رسم PDF لسند الاستلام والكشف (jsPDF + خط Noto Sans Arabic، كبقية مستندات أَوْج: لا محرك PDF خادمي في المنصة، فيُرسم الملف في
 * المتصفح من حمولة يحكمها الخادم — النسخة المالية لا تصل غير المخوَّل، فلا يمكن لواجهة أن «تُظهر» ما لم يُرسَل إليها).
 * الأرقام والتواريخ 0–9 دائماً. لا طلب API هنا (الخط أصل ثابت من `/fonts`).
 */

export type PdfDoc = import('jspdf').jsPDF & { processArabic?: (text: string) => string };

export const FONT_FILE = 'NotoSansArabic-Regular.ttf';
export const FONT_FAMILY = 'NotoSansArabic';

let fontDataPromise: Promise<string> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += chunk) binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + chunk, bytes.length)));
  return btoa(binary);
}

function arabicFontData(): Promise<string> {
  if (!fontDataPromise) {
    fontDataPromise = fetch('/fonts/NotoSansArabic-Regular.ttf')
      .then((response) => {
        if (!response.ok) throw new Error('Arabic PDF font could not be loaded');
        return response.arrayBuffer();
      })
      .then(toBase64)
      .catch((error) => { fontDataPromise = null; throw error; });
  }
  return fontDataPromise;
}

/** `format` اختياري: افتراضياً A4؛ مقاس مخصص [عرض، ارتفاع] بالمم (الإيصالات الحرارية 58/80مم، HORIZON-REPORTS). */
export async function newPdf(orientation: 'portrait' | 'landscape', format: 'a4' | 'a5' | [number, number] = 'a4'): Promise<PdfDoc> {
  const [{ jsPDF }, font] = await Promise.all([import('jspdf'), arabicFontData()]);
  const pdf = new jsPDF({ unit: 'mm', format, orientation, putOnlyUsedFonts: true }) as PdfDoc;
  pdf.addFileToVFS(FONT_FILE, font);
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'normal');
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'bold');
  return pdf;
}

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
export const hasArabic = (text: string): boolean => ARABIC.test(text);

export interface TextStyle { size?: number; bold?: boolean; align?: 'left' | 'right' | 'center'; color?: [number, number, number]; maxWidth?: number }

/** فراغ وعلامات ترقيم لاتينية: عند حدّ المقطع العربي تُرسم قطعاً مستقلة (وإلا ظهرت النقطة الختامية في أول السطر بدل آخره). */
const BOUNDARY_NEUTRALS = ' :.,;!?';

/** حروف لاتينية وأرقام: تُرسم دائماً بـ Helvetica كمقطع مستقل (تفادي إعادة ترتيب الأرقام داخل النص العربي). */
const LATIN_LETTER = /[A-Za-z0-9]/;

/** مقاطع النص بحسب الخط اللازم: خط Noto العربي لا يحوي الحروف اللاتينية (تختفي)، فتُرسم المقاطع اللاتينية والأرقام بـ Helvetica والعربية بـ Noto. المحايد (مسافة/ترقيم) يلتصق بالمقطع السابق. */
export function scriptRuns(value: string): Array<{ text: string; arabic: boolean; neutral?: boolean }> {
  // نص بلا عربي: مقطع لاتيني واحد كما كان (لا حاجة لأي تقطيع).
  if (!hasArabic(value)) return value === '' ? [] : [{ text: value, arabic: false }];
  const chars = [...value];
  const kind = chars.map((c) => (ARABIC.test(c) ? 'A' : LATIN_LETTER.test(c) ? 'L' : 'N'));
  const out: Array<{ text: string; arabic: boolean; neutral?: boolean }> = [];
  chars.forEach((char, i) => {
    // (1) الأقواس: تشكيل jsPDF للعربية يُسقط كل ما قبل القوس إن كان داخل المقطع العربي، فتصير قطعة مستقلة (يعكس شكلها `text()` في اتجاه RTL).
    // (2) الفراغ وعلامات الترقيم اللاتينية (: . , ; ! ?) غير المحصورة بين حرفين عربيين مباشرة: قطعة مستقلة بترتيبها المنطقي، فلا يضيع الفراغ عند الحدّ ولا يقفز «:» إلى الطرف الآخر.
    //     أما الفراغ بين كلمتين عربيتين فيبقى في مقطعه (التشكيل يعتمد عليه).
    const standalone = char === '(' || char === ')'
      || (BOUNDARY_NEUTRALS.includes(char) && !(kind[i - 1] === 'A' && kind[i + 1] === 'A') && !(kind[i - 1] === 'L' && kind[i + 1] === 'L'));
    if (standalone) {
      out.push({ text: char, arabic: false, neutral: true });
      return;
    }
    const arabic = kind[i] === 'A' ? true : kind[i] === 'L' ? false : (out.length > 0 ? out[out.length - 1].arabic : true);
    const last = out[out.length - 1];
    if (last && !last.neutral && last.arabic === arabic) last.text += char;
    else out.push({ text: char, arabic });
  });
  return out;
}

function setFace(pdf: PdfDoc, arabic: boolean, bold: boolean, size: number, color: [number, number, number]): void {
  pdf.setTextColor(color[0], color[1], color[2]);
  pdf.setFont(arabic ? FONT_FAMILY : 'helvetica', bold ? 'bold' : 'normal');
  pdf.setFontSize(size);
}

/** عرض المقاطع المشكَّلة بالمم عند حجم معيّن. */
function measure(pdf: PdfDoc, parts: Array<{ shown: string; arabic: boolean }>, bold: boolean, size: number): number {
  return parts.reduce((sum, part) => { setFace(pdf, part.arabic, bold, size, [0, 0, 0]); return sum + pdf.getTextWidth(part.shown); }, 0);
}

/**
 * يرسم نصاً بالخط المناسب لكل مقطع منه (عربي/لاتيني) بترتيب منطقي: المحاذاة `right` تضع المقاطع من اليمين إلى اليسار (اتجاه عربي) وغيرها من اليسار.
 * `maxWidth`: يصغَّر الخط تدريجياً (حتى 5.5pt) كي لا يُقتطع اسم طويل بصمت.
 */
export function text(pdf: PdfDoc, value: string, x: number, y: number, style: TextStyle = {}): void {
  const { size = 9, bold = false, align = 'left', color = [17, 24, 39], maxWidth } = style;
  const runs = scriptRuns(value);
  const rtl = align === 'right' || (align === 'center' && runs.find((run) => !run.neutral)?.arabic === true);
  const mirror = (ch: string) => (ch === '(' ? ')' : ch === ')' ? '(' : ch);
  // الأقواس في اتجاه RTL تُعكس (القوس المنطقي الأول يظهر مفتوحاً نحو النص) كما في الاتجاه الثنائي القياسي.
  const parts = runs.map((run) => ({ ...run, shown: run.neutral ? (rtl ? mirror(run.text) : run.text) : (run.arabic && pdf.processArabic ? pdf.processArabic(run.text) : run.text) }));
  let fontSize = size;
  if (maxWidth !== undefined) {
    while (fontSize > 5.5 && measure(pdf, parts, bold, fontSize) > maxWidth) fontSize -= 0.5;
  }
  const total = measure(pdf, parts, bold, fontSize);
  let cursor = align === 'center' ? x + (rtl ? total / 2 : -total / 2) : x;
  if (align === 'left') cursor = x;
  const ordered = rtl ? parts : parts;
  for (const part of ordered) {
    setFace(pdf, part.arabic, bold, fontSize, color);
    const width = pdf.getTextWidth(part.shown);
    if (rtl) { pdf.text(part.shown, cursor, y, { align: 'right' }); cursor -= width; }
    else { pdf.text(part.shown, cursor, y, { align: 'left' }); cursor += width; }
  }
}

export function fitText(pdf: PdfDoc, value: string, x: number, y: number, width: number, style: TextStyle = {}): void {
  text(pdf, value, x, y, { ...style, maxWidth: width });
}

/** عرض النص بالمم بالمقاطع نفسها التي يرسمها `text()` (عربي/لاتيني). */
export function textWidth(pdf: PdfDoc, value: string, size: number, bold = false): number {
  const parts = scriptRuns(value).map((run) => ({ ...run, shown: run.arabic && pdf.processArabic ? pdf.processArabic(run.text) : run.text }));
  return measure(pdf, parts, bold, size);
}

/**
 * يقسم نصاً إلى أسطر بعرض أقصى: القطع عند المسافات أولاً، ثم عند الشرطة/الشرطة السفلية/المائلة داخل المرجع الطويل (فلا تُكسر كلمة وسطها إن أمكن)،
 * وبالحرف فقط إن كان المقطع وحده أعرض من السطر. ترتيب الأسطر منطقي.
 */
export function wrapLines(pdf: PdfDoc, value: string, width: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  let current = '';
  const fits = (candidate: string) => textWidth(pdf, candidate, size, bold) <= width;
  const place = (piece: string, joiner: string) => {
    const candidate = current === '' ? piece : `${current}${joiner}${piece}`;
    if (fits(candidate)) { current = candidate; return; }
    if (current !== '') { lines.push(current); current = ''; }
    if (fits(piece)) { current = piece; return; }
    for (const char of piece) {
      if (current !== '' && !fits(current + char)) { lines.push(current); current = ''; }
      current += char;
    }
  };
  for (const word of value.split(/\s+/).filter(Boolean)) {
    // مقاطع الكلمة تنتهي بفاصل مقبول (- _ /) ويلتصق بعضها ببعض بلا مسافة؛ الكلمات تُفصل بمسافة.
    const segments = word.split(/(?<=[-_/])/);
    segments.forEach((segment, index) => place(segment, index === 0 ? ' ' : ''));
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * قيمة قد تطول (مرجع/اسم): تُصغَّر حتى `minSize` في سطر واحد، فإن لم تتسع تُلَفّ على أسطر (حتى `maxLines`، والزائد يُختم بـ«…») بالحجم الأساسي
 * فلا يُقصّ نص ولا يتداخل مع الخلية المجاورة. يعيد عدد الأسطر المرسومة.
 */
export function fitLines(pdf: PdfDoc, value: string, x: number, y: number, width: number, style: TextStyle = {}, maxLines = 3, lineHeight = 3.6, minSize = 6.5): number {
  const { size = 9, bold = false } = style;
  let fontSize = size;
  while (fontSize > minSize && textWidth(pdf, value, fontSize, bold) > width) fontSize -= 0.5;
  if (textWidth(pdf, value, fontSize, bold) <= width) { text(pdf, value, x, y, { ...style, size: fontSize }); return 1; }
  let lines = wrapLines(pdf, value, width, size, bold);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && textWidth(pdf, `${last}…`, size, bold) > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  lines.forEach((line, index) => text(pdf, line, x, y + index * lineHeight, { ...style, size }));
  return lines.length;
}

/** نص بعدة أسطر داخل عرض معيّن؛ يعيد الارتفاع المستهلك (مم). */
export function paragraph(pdf: PdfDoc, value: string, x: number, y: number, width: number, style: TextStyle = {}, lineHeight = 4.4): number {
  const { size = 9, bold = false, align = 'left', color = [17, 24, 39] } = style;
  pdf.setTextColor(color[0], color[1], color[2]);
  const arabic = hasArabic(value);
  pdf.setFont(arabic ? FONT_FAMILY : 'helvetica', bold ? 'bold' : 'normal');
  pdf.setFontSize(size);
  const shaped = arabic && pdf.processArabic ? pdf.processArabic(value) : value;
  const lines = pdf.splitTextToSize(shaped, width) as string[];
  lines.forEach((line, i) => pdf.text(line, x, y + i * lineHeight, { align }));
  return Math.max(1, lines.length) * lineHeight;
}

export function filled(pdf: PdfDoc, x: number, y: number, w: number, h: number, rgb: [number, number, number], radius = 0): void {
  pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
  if (radius > 0) pdf.roundedRect(x, y, w, h, radius, radius, 'F');
  else pdf.rect(x, y, w, h, 'F');
}

export function line(pdf: PdfDoc, x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = [209, 213, 219], width = 0.2): void {
  pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
  pdf.setLineWidth(width);
  pdf.line(x1, y1, x2, y2);
}

// ───────────── تنسيق (0–9 دائماً) ─────────────

/** لترات كنص عشري من الخادم ⇒ ثلاث منازل (بلا float). مثال: "9.5" ⇒ "9.500" ومع فاصل آلاف. */
export function litersText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${(fraction + '000').slice(0, 3)}`;
}

/** هللات ⇒ "1,234.56" بلا float. */
export function minorText(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0 ? '-' : ''}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

export function dateText(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
