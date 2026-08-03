// تصدير ملف Excel حقيقي (.xlsx) عبر SheetJS، مستورَدة ديناميكياً.

export interface XlsxSheet {
  /** أسطر ترويسية (بيانات المستند) قبل الجدول — كل سطر مصفوفة خلايا. */
  meta?: (string | number)[][];
  /** رؤوس أعمدة الجدول. */
  columns: string[];
  /** صفوف الجدول (أرقام نصّية تبقى نصّاً؛ الأرقام الفعلية تُجمَع في Excel). */
  rows: (string | number | null | undefined)[][];
  sheetName?: string;
}

/** يبني ملف xlsx وينزّله. */
export async function exportXlsx(filename: string, sheet: XlsxSheet): Promise<void> {
  const XLSX = await import('xlsx');
  const aoa: (string | number | null | undefined)[][] = [
    ...(sheet.meta ?? []),
    ...(sheet.meta && sheet.meta.length ? [[]] : []),
    sheet.columns,
    ...sheet.rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = sheet.columns.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName ?? 'Sheet1');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
