// توليد PDF من عنصر مستند HTML (html2canvas + jsPDF)، مع تنزيل ومشاركة كملف.
// المكتبتان تُستورَدان ديناميكياً فلا تُثقلان الحزمة الأساسية.
// العنصر مرئيّ على الشاشة (#print-root)؛ يُلتقَط في مكانه ويُقاس حسب حجم الورق.

/** أبعاد الورق بالمليمتر. heightMm ≤ 0 = ارتفاع مفتوح (إيصال حراري، صفحة واحدة). */
export interface PdfPaper {
  widthMm: number;
  heightMm: number;
}

const A4: PdfPaper = { widthMm: 210, heightMm: 297 };

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

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    windowWidth: el.scrollWidth,
  });
  const img = canvas.toDataURL('image/png');
  const pw = paper.widthMm;
  const imgH = (canvas.height * pw) / canvas.width;

  // ارتفاع مفتوح (حراري): صفحة واحدة بمقاس المحتوى، بلا ترقيم صفحات.
  if (paper.heightMm <= 0) {
    const pdf = new JsPDF({ unit: 'mm', format: [pw, imgH], orientation: 'portrait' });
    pdf.addImage(img, 'PNG', 0, 0, pw, imgH);
    return pdf.output('blob');
  }

  // ورق ثابت (A4/Letter/Legal): ترقيم صفحات بارتفاع الصفحة.
  const ph = paper.heightMm;
  const pdf = new JsPDF({ unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait' });
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
