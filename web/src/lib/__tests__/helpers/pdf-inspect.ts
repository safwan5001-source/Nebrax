import { inflateSync } from 'node:zlib';

/**
 * فاحص PDF لاختبارات الانحدار (بلا اعتماد خارجي): يقرأ ما يكتبه jsPDF فعلاً — عدد الصفحات،
 * مقاس كل صفحة، الصور المضمّنة (بعد فكّ Flate ومرشّح PNG) ووجود طبقة نص. يُستعمل في Vitest
 * وفي مواصفة Playwright، فالقياسات واحدة في الموضعين.
 */
export interface InspectedImage {
  width: number;
  height: number;
  /** بكسلات RGB (3 بايت/بكسل) بعد فكّ الضغط والمرشّح. */
  rgb: Uint8Array;
}

export interface InspectedPdf {
  bytes: number;
  pageCount: number;
  /** أبعاد كل صفحة بالنقاط (pt). */
  mediaBoxes: Array<{ widthPt: number; heightPt: number }>;
  images: InspectedImage[];
  /** هل يحوي أي تيار محتوى عوامل نص (Tj/TJ)؟ PDF الصورة لا يحويها. */
  hasTextLayer: boolean;
  /** أكبر نسبة ضغط مفقودة: صور مخزّنة بلا Filter. */
  hasUncompressedImages: boolean;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilterPng(data: Uint8Array, columns: number, colors: number, rows: number): Uint8Array {
  const stride = columns * colors;
  const out = new Uint8Array(stride * rows);
  for (let row = 0; row < rows; row += 1) {
    const type = data[row * (stride + 1)];
    const src = row * (stride + 1) + 1;
    const dst = row * stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= colors ? out[dst + i - colors] : 0;
      const up = row > 0 ? out[dst - stride + i] : 0;
      const upLeft = row > 0 && i >= colors ? out[dst - stride + i - colors] : 0;
      const raw = data[src + i];
      let value: number;
      switch (type) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + ((left + up) >> 1); break;
        case 4: value = raw + paeth(left, up, upLeft); break;
        default: throw new Error(`مرشّح PNG غير معروف: ${type}`);
      }
      out[dst + i] = value & 0xff;
    }
  }
  return out;
}

function numberAfter(dict: string, key: string): number | null {
  const match = new RegExp(`/${key}\\s+(\\d+)`).exec(dict);
  return match ? Number(match[1]) : null;
}

export function inspectPdf(input: ArrayBuffer | Uint8Array): InspectedPdf {
  const buffer = Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input));
  const text = buffer.toString('latin1');

  const pageCount = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const mediaBoxes = [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((m) => ({ widthPt: Number(m[1]), heightPt: Number(m[2]) }))
    // jsPDF يكتب MediaBox لكل صفحة؛ إن ورد في جذر الصفحات أيضاً نكتفي بعدد الصفحات.
    .slice(0, pageCount || undefined);

  const images: InspectedImage[] = [];
  let hasTextLayer = false;
  let hasUncompressedImages = false;

  const streamPattern = /<<((?:(?!>>\s*stream)[\s\S])*?(?:<<[^>]*>>)?[^>]*?)>>\s*stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(text)) !== null) {
    const dict = match[1];
    const start = match.index + match[0].length;
    const length = numberAfter(dict, 'Length');
    if (length === null) continue;
    const slice = buffer.subarray(start, start + length);
    const isFlate = /\/FlateDecode/.test(dict);

    if (/\/Subtype\s*\/Image/.test(dict)) {
      const width = numberAfter(dict, 'Width') ?? 0;
      const height = numberAfter(dict, 'Height') ?? 0;
      if (!/\/DeviceRGB/.test(dict)) continue; // قناة الشفافية (SMask) وغيرها
      if (!isFlate) hasUncompressedImages = true;
      const decoded = isFlate ? new Uint8Array(inflateSync(slice)) : new Uint8Array(slice);
      const predictor = numberAfter(dict, 'Predictor');
      const rgb = predictor && predictor >= 10
        ? unfilterPng(decoded, width, 3, height)
        : decoded;
      images.push({ width, height, rgb });
    } else if (isFlate) {
      try {
        const content = inflateSync(slice).toString('latin1');
        if (/\bBT\b[\s\S]*?\b(Tj|TJ)\b/.test(content)) hasTextLayer = true;
      } catch {
        /* تيار غير محتوى (خطوط/بيانات وصفية) */
      }
    } else if (/\bBT\b[\s\S]*?\b(Tj|TJ)\b/.test(slice.toString('latin1'))) {
      hasTextLayer = true;
    }
  }

  return { bytes: buffer.length, pageCount, mediaBoxes, images, hasTextLayer, hasUncompressedImages };
}

/** يلصق صور الصفحات رأسياً بالترتيب (RGB) — صفحات PDF الصورية متجاورة بلا تداخل. */
export function stitchImages(images: readonly InspectedImage[]): InspectedImage {
  const width = images[0]?.width ?? 0;
  const height = images.reduce((sum, image) => sum + image.height, 0);
  const rgb = new Uint8Array(width * height * 3);
  let offset = 0;
  for (const image of images) {
    if (image.width !== width) throw new Error('عرض صور الصفحات غير متطابق');
    rgb.set(image.rgb, offset);
    offset += image.rgb.length;
  }
  return { width, height, rgb };
}

/** نسبة البكسلات غير البيضاء داخل مستطيل من صورة (إحداثيات بكسل الصورة). */
export function inkRatioInRegion(image: InspectedImage, x: number, y: number, w: number, h: number): number {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(image.width, Math.ceil(x + w));
  const y1 = Math.min(image.height, Math.ceil(y + h));
  let ink = 0;
  let total = 0;
  for (let row = y0; row < y1; row += 1) {
    for (let col = x0; col < x1; col += 1) {
      const i = (row * image.width + col) * 3;
      total += 1;
      if (image.rgb[i] < 245 || image.rgb[i + 1] < 245 || image.rgb[i + 2] < 245) ink += 1;
    }
  }
  return total === 0 ? 0 : ink / total;
}
