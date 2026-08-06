'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DocumentView } from '@/modules/documents/components/document-view';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { printDocument } from '@/modules/documents/services/export';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import type { DocumentModel } from '@/modules/documents/types';

export interface Receipt {
  /** نموذج المستند للإيصال الحراري (يُبنى من السلة عبر محرّك المستندات). */
  model: DocumentModel;
  number: string;
}

/** قالب الإيصال الحراري (80mm) وورقه. */
const RECEIPT_TEMPLATE = 'tax-invoice-thermal80';
const RECEIPT_PAPER = { widthMm: PAPER_SIZES.thermal_80.widthMm, heightMm: PAPER_SIZES.thermal_80.heightMm };

/**
 * حوار إيصال ما بعد البيع — إيصال حراري حقيقي عبر محرّك المستندات (بنود/ضريبة/QR/
 * تذييل). الطباعة عبر متصفّح النظام (`#print-root`) لا html2canvas، فلا قصّ. `autoPrint`
 * (من إعداد print_receipt) يطلق الطباعة مرّة واحدة عند ظهور الإيصال.
 */
export function ReceiptDialog({
  receipt,
  autoPrint = false,
  onClose,
}: {
  receipt: Receipt | null;
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('pos');
  const printedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!receipt || !autoPrint) return;
    if (printedFor.current === receipt.number) return;
    printedFor.current = receipt.number;
    const id = window.setTimeout(() => {
      try { printDocument(RECEIPT_PAPER); } catch { /* تجاهل — الزرّ متاح يدوياً */ }
    }, 300);
    return () => window.clearTimeout(id);
  }, [receipt, autoPrint]);

  if (!receipt) return null;

  return (
    <Dialog open={!!receipt} onClose={onClose} title={t('receipt')} className="max-w-xs">
      <div className="max-h-[60vh] overflow-auto rounded-lg bg-gray-100 p-2 dark:bg-black/30">
        <DocumentScaler>
          <DocumentView model={receipt.model} templateId={RECEIPT_TEMPLATE} rootId="print-root" />
        </DocumentScaler>
      </div>
      <div className="mt-4 flex justify-end gap-2 no-print">
        <Button variant="outline" onClick={onClose}>
          {t('new_sale')}
        </Button>
        <Button onClick={() => printDocument(RECEIPT_PAPER)}>{t('print')}</Button>
      </div>
    </Dialog>
  );
}
