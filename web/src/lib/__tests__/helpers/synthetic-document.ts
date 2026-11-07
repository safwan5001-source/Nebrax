import { crc32, deflateSync } from 'node:zlib';
import type { PdfRaster } from '@/lib/pdf';

/**
 * مستند اصطناعي بدقة التصدير الفعلية (A4 عرض 794px × scale 2 = 1588px) يحاكي ما يلتقطه
 * html2canvas: ترويسة وشعار، صفوف جدول (نهاية كل صف حدّ آمن)، إجماليات، رمز QR، باركود،
 * توقيع، وتذييل. حتمي (PRNG بذرة ثابتة) ليكون القياس قابلاً للمقارنة بين التشغيلات.
 */
export const DOC_WIDTH = 1588;
export const ROW_HEIGHT = 92;

export interface SyntheticDocument {
  raster: PdfRaster;
  rgba: Uint8Array;
  width: number;
  height: number;
  /** نهايات الصفوف والأقسام (بكسل كانفاس) — تماثل `getSafeCanvasBreaks`. */
  safeBreaks: number[];
  /** مناطق يجب أن تصل سليمة إلى PDF (بكسل كانفاس). */
  regions: { name: string; top: number; height: number }[];
  /** ارتفاع الفراغ الأبيض الختامي المُضاف (يحاكي min-height والتذييل المثبَّت). */
  trailingBlank: number;
}

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA كما يُنتجها canvas.toDataURL
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makeSyntheticDocument(options: { rows: number; trailingBlank?: number; seed?: number }): SyntheticDocument {
  const rand = prng(options.seed ?? 7);
  const width = DOC_WIDTH;
  const headerH = 360;
  const tableHead = 70;
  const totalsH = 380;
  const signatureH = 180;
  const footerH = 90;
  const trailingBlank = options.trailingBlank ?? 0;
  const height = headerH + tableHead + options.rows * ROW_HEIGHT + totalsH + signatureH + footerH + trailingBlank;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  const safeBreaks: number[] = [];
  const regions: SyntheticDocument['regions'] = [];

  const rect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
    for (let yy = y; yy < Math.min(height, y + h); yy += 1) {
      for (let xx = x; xx < Math.min(width, x + w); xx += 1) {
        const i = (yy * width + xx) * 4;
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
      }
    }
  };
  /** كتلة «نص»: شرائح رمادية بأطوال متغيرة تحاكي كلمات (وشبه حروف عربية متصلة). */
  const textBlock = (x: number, y: number, w: number, h: number, gray: number) => {
    for (let line = 0; line < Math.floor(h / 14); line += 1) {
      let cursor = x;
      while (cursor < x + w - 20) {
        const word = 18 + Math.floor(rand() * 70);
        rect(cursor, y + line * 14 + 2, Math.min(word, x + w - cursor), 8, gray, gray, gray);
        cursor += word + 10;
      }
    }
  };

  // الترويسة: شعار ملوّن + بيانات
  rect(1300, 40, 240, 240, 29, 78, 216);
  rect(1340, 80, 160, 160, 255, 255, 255);
  rect(1360, 100, 120, 120, 29, 78, 216);
  textBlock(60, 50, 1100, 230, 30);
  rect(0, headerH - 8, width, 4, 20, 20, 20);
  regions.push({ name: 'header+logo', top: 0, height: headerH });
  safeBreaks.push(headerH);

  // ترويسة الجدول
  rect(0, headerH, width, tableHead, 30, 41, 59);
  textBlock(60, headerH + 20, 1400, 30, 255);
  let y = headerH + tableHead;
  safeBreaks.push(y);
  for (let row = 0; row < options.rows; row += 1) {
    textBlock(60, y + 12, 1450, ROW_HEIGHT - 24, 40);
    rect(0, y + ROW_HEIGHT - 2, width, 2, 200, 200, 200);
    y += ROW_HEIGHT;
    safeBreaks.push(y);
  }
  regions.push({ name: 'table', top: headerH, height: tableHead + options.rows * ROW_HEIGHT });

  // الإجماليات + QR (وحدات 12px، 33×33) + باركود
  const totalsTop = y;
  textBlock(900, totalsTop + 30, 640, 150, 20);
  rect(900, totalsTop + 200, 640, 6, 0, 0, 0);
  const qr = 33;
  const finderDark = (lx: number, ly: number) => {
    const ring = lx === 0 || ly === 0 || lx === 6 || ly === 6;
    const core = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
    return ring || core;
  };
  for (let qy = 0; qy < qr; qy += 1) {
    for (let qx = 0; qx < qr; qx += 1) {
      let dark: boolean;
      if (qx < 7 && qy < 7) dark = finderDark(qx, qy);
      else if (qx >= qr - 7 && qy < 7) dark = finderDark(qx - (qr - 7), qy);
      else if (qx < 7 && qy >= qr - 7) dark = finderDark(qx, qy - (qr - 7));
      else dark = rand() > 0.5;
      if (dark) rect(60 + qx * 8, totalsTop + 20 + qy * 8, 8, 8, 0, 0, 0);
    }
  }
  for (let bar = 0, bx = 400; bar < 60; bar += 1) {
    const bw = 2 + Math.floor(rand() * 5);
    if (bar % 2 === 0) rect(bx, totalsTop + 250, bw, 90, 0, 0, 0);
    bx += bw + 1;
  }
  regions.push({ name: 'totals+qr+barcode', top: totalsTop, height: totalsH });
  y += totalsH;
  safeBreaks.push(y);

  // التوقيع: خط مائل رفيع
  for (let t = 0; t < 400; t += 1) rect(120 + t, y + 40 + Math.round(60 * Math.sin(t / 25)) + 60, 3, 3, 10, 10, 120);
  rect(100, y + 150, 500, 2, 0, 0, 0);
  regions.push({ name: 'signature', top: y, height: signatureH });
  y += signatureH;
  safeBreaks.push(y);

  // التذييل
  rect(0, y, width, 2, 120, 120, 120);
  textBlock(300, y + 20, 1000, 40, 110);
  regions.push({ name: 'footer', top: y, height: footerH });

  const raster: PdfRaster = {
    width,
    height,
    slicePng(top, sliceHeight) {
      const rows = Math.min(Math.ceil(sliceHeight), height - top);
      const part = rgba.subarray(top * width * 4, (top + rows) * width * 4);
      return `data:image/png;base64,${encodePng(part, width, rows).toString('base64')}`;
    },
  };

  return { raster, rgba, width, height, safeBreaks, regions, trailingBlank };
}
