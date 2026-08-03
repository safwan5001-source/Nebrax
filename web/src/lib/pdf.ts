// توليد PDF من عنصر مستند HTML (html2canvas + jsPDF)، مع تنزيل ومشاركة كملف.
// المكتبتان تُستورَدان ديناميكياً فلا تُثقلان الحزمة الأساسية.
// العنصر print-only (display:none)؛ نُظهره بتخطيط كامل خارج الشاشة أثناء الالتقاط.

async function elementToPdfBlob(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, jspdf] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const JsPDF = jspdf.jsPDF;

  const prev = el.getAttribute('style') ?? '';
  el.setAttribute(
    'style',
    'display:block;position:fixed;top:0;left:-10000px;width:210mm;background:#ffffff;z-index:-1;'
  );
  try {
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: el.scrollWidth,
    });
    const img = canvas.toDataURL('image/png');
    const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pw = pdf.internal.pageSize.getWidth(); // 210
    const ph = pdf.internal.pageSize.getHeight(); // 297
    const imgH = (canvas.height * pw) / canvas.width;

    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(img, 'PNG', 0, position, pw, imgH);
    heightLeft -= ph;
    while (heightLeft > 0) {
      position -= ph;
      pdf.addPage();
      pdf.addImage(img, 'PNG', 0, position, pw, imgH);
      heightLeft -= ph;
    }
    return pdf.output('blob');
  } finally {
    el.setAttribute('style', prev);
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/** يولّد PDF من العنصر ويُنزّله. */
export async function downloadPdf(el: HTMLElement, filename: string): Promise<void> {
  const blob = await elementToPdfBlob(el);
  triggerDownload(blob, filename);
}

/**
 * يولّد PDF ويشاركه كملف عبر Web Share API (واتساب/بريد…).
 * يُعيد 'shared' عند النجاح، 'downloaded' عند عدم دعم مشاركة الملفات (تراجع للتنزيل).
 */
export async function sharePdf(el: HTMLElement, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const blob = await elementToPdfBlob(el);
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
