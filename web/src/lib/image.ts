/**
 * يقرأ ملف صورة ويُعيد data URL مصغّراً (أقصى بُعد `maxDim`) — يقلّص الحجم المخزَّن
 * في إعدادات المستأجر (JSON) فلا يتضخّم. يحافظ على النسبة، ويُخرج PNG (شفافية الشعار).
 */
export async function fileToResizedDataUrl(file: File, maxDim = 320): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('decode_failed'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height || 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl; // تعذّر التصغير — نُعيد الأصل
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}
