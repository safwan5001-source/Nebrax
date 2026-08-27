export type LogoPixelSummary = {
  totalPixels: number;
  visiblePixels: number;
  transparentPixels: number;
  nonWhitePixels: number;
};

export type LogoContentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * يرفض الشعارات التي تُحمّل تقنياً لكنها فارغة بصرياً (شفافة بالكامل أو
 * مستطيل أبيض شبه موحّد). لا يرفض شعاراً أبيض على خلفية شفافة لأن وجود
 * الشفافية حول العلامة يجعله شعاراً صالحاً للاستخدام على الأسطح الداكنة.
 */
export function summarizeLogoPixels(data: Uint8ClampedArray): LogoPixelSummary {
  const totalPixels = Math.floor(data.length / 4);
  let visiblePixels = 0;
  let transparentPixels = 0;
  let nonWhitePixels = 0;

  for (let index = 0; index + 3 < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];

    if (alpha < 16) {
      transparentPixels += 1;
      continue;
    }

    visiblePixels += 1;
    if (red < 245 || green < 245 || blue < 245) {
      nonWhitePixels += 1;
    }
  }

  return { totalPixels, visiblePixels, transparentPixels, nonWhitePixels };
}

export function hasMeaningfulLogoPixels(data: Uint8ClampedArray): boolean {
  const summary = summarizeLogoPixels(data);
  if (summary.totalPixels === 0 || summary.visiblePixels === 0) return false;

  const visibleRatio = summary.visiblePixels / summary.totalPixels;
  const transparentRatio = summary.transparentPixels / summary.totalPixels;
  const nonWhiteRatio = summary.nonWhitePixels / Math.max(1, summary.visiblePixels);

  // صورة شفافة بالكامل/تقريباً لا تحمل علامة قابلة للعرض.
  if (visibleRatio < 0.01) return false;

  // وجود شفافية معتبرة مع بكسلات مرئية يعني أن هناك شكلاً فعلياً، حتى لو
  // كانت العلامة نفسها بيضاء (حالة شعار أبيض بخلفية شفافة).
  if (transparentRatio >= 0.02) return true;

  // في الصور المعتمة نحتاج مقداراً صغيراً على الأقل من التفاصيل غير البيضاء؛
  // المستطيل الأبيض الصافي أو شبه الصافي يُعامل كبيانات شعار تالفة/فارغة.
  return nonWhiteRatio >= 0.002;
}

/**
 * يحسب حدود العلامة الفعلية داخل صورة الشعار لقص الهوامش البيضاء/الشفافة
 * لأغراض العرض فقط. لا يغير الملف المخزن ولا بيانات المنشأة.
 */
export function findLogoContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): LogoContentBounds | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;

  const summary = summarizeLogoPixels(data);
  if (!hasMeaningfulLogoPixels(data)) return null;

  const transparentRatio = summary.transparentPixels / Math.max(1, summary.totalPixels);
  const hasTransparentBackground = transparentRatio >= 0.02;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];

      const belongsToMark = hasTransparentBackground
        ? alpha >= 16
        : alpha >= 16 && (red < 245 || green < 245 || blue < 245);

      if (!belongsToMark) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const padding = Math.max(2, Math.round(Math.max(contentWidth, contentHeight) * 0.08));

  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);

  return {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
  };
}
