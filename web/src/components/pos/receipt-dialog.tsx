'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { PosDialog } from '@/components/pos/pos-dialog';
import { Button } from '@/components/ui/button';
import { DocumentView } from '@/modules/documents/components/document-view';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { printDocument } from '@/modules/documents/services/export';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { getTemplate } from '@/modules/documents/registry/templates';
import { resolveTemplateRevisionDefinition, type LiveTemplateRevision } from '@/modules/print-templates/services/live-template-definition';
import type { DocumentModel } from '@/modules/documents/types';
import { formatRiyal } from '@/lib/money';

export interface Receipt {
  /** نموذج المستند للإيصال الحراري (يُبنى من السلة عبر محرّك المستندات). */
  model: DocumentModel;
  number: string;
  /** لقطة مراجعة thermal التي ثبتها الخادم وقت ترحيل فاتورة البيع. */
  thermalTemplateRevision?: LiveTemplateRevision | null;
}

type ReceiptPaperSize = 'thermal_58' | 'thermal_80';

/** قالب الإيصال الحراري وورقه؛ يختاره إعداد POS مرة واحدة للعرض والطباعة. */
const RECEIPT_FORMATS = {
  thermal_58: {
    templateId: 'tax-invoice-thermal58',
    paper: { widthMm: PAPER_SIZES.thermal_58.widthMm, heightMm: PAPER_SIZES.thermal_58.heightMm },
  },
  thermal_80: {
    templateId: 'tax-invoice-thermal80',
    paper: { widthMm: PAPER_SIZES.thermal_80.widthMm, heightMm: PAPER_SIZES.thermal_80.heightMm },
  },
} as const;

/**
 * حوار إيصال ما بعد البيع — إيصال حراري حقيقي عبر محرّك المستندات (بنود/ضريبة/QR/
 * تذييل). الطباعة عبر متصفّح النظام (`#print-root`) لا html2canvas، فلا قصّ. `autoPrint`
 * (من إعداد print_receipt) يطلق الطباعة مرّة واحدة عند ظهور الإيصال.
 */
export function ReceiptDialog({
  receipt,
  autoPrint = false,
  paperSize = 'thermal_80',
  onClose,
}: {
  receipt: Receipt | null;
  autoPrint?: boolean;
  paperSize?: ReceiptPaperSize;
  onClose: () => void;
}) {
  const t = useTranslations('pos');
  const printedFor = useRef<string | null>(null);
  const resolvedTemplate = useMemo(
    () => resolveTemplateRevisionDefinition(receipt?.thermalTemplateRevision, 'tax_invoice'),
    [receipt?.thermalTemplateRevision],
  );
  const format = useMemo(() => {
    const fallback = RECEIPT_FORMATS[paperSize];
    if (!resolvedTemplate || !getTemplate(resolvedTemplate.templateId).supportedPaper.includes(paperSize)) {
      return fallback;
    }

    return {
      ...fallback,
      templateId: resolvedTemplate.templateId,
      themeId: resolvedTemplate.themeId,
      showLogo: resolvedTemplate.showLogo,
      layout: resolvedTemplate.layout,
    };
  }, [paperSize, resolvedTemplate]);

  useEffect(() => {
    if (!receipt || !autoPrint) return;
    if (printedFor.current === receipt.number) return;
    printedFor.current = receipt.number;
    const id = window.setTimeout(() => {
      try { printDocument(format.paper); } catch { /* تجاهل — الزرّ متاح يدوياً */ }
    }, 300);
    return () => window.clearTimeout(id);
  }, [receipt, autoPrint, format.paper]);

  if (!receipt) return null;

  const totalMinor = receipt.model.totals?.total ?? 0;

  return (
    <PosDialog open={!!receipt} onClose={onClose} title={t('receipt')} className="max-w-md sm:max-w-lg">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3" data-testid="pos-receipt-success">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-positive" strokeWidth={1.7} aria-hidden />
              {t('receipt_done')}
            </div>
            <p className="num mt-1 truncate text-sm font-semibold text-text">{receipt.number}</p>
          </div>
          <div className="shrink-0 text-end">
            <div className="text-[11px] font-semibold text-muted">{t('total')}</div>
            <div className="num text-lg font-bold text-text">{formatRiyal(totalMinor / 100)}</div>
          </div>
        </div>

        <div className="max-h-[min(55vh,28rem)] overflow-auto rounded-md border border-border bg-background p-3">
          <DocumentScaler>
            <DocumentView
              model={receipt.model}
              templateId={format.templateId}
              themeId={'themeId' in format ? format.themeId : undefined}
              showLogo={'showLogo' in format ? format.showLogo : undefined}
              layout={'layout' in format ? format.layout : undefined}
              rootId="print-root"
            />
          </DocumentScaler>
        </div>

        <div className="flex flex-col gap-2 no-print sm:flex-row sm:justify-end">
          <Button variant="outline" className="min-h-11 touch-manipulation sm:min-w-28" onClick={onClose}>
            {t('new_sale')}
          </Button>
          <Button className="min-h-11 touch-manipulation sm:min-w-28" onClick={() => printDocument(format.paper)}>
            {t('print')}
          </Button>
        </div>
      </div>
    </PosDialog>
  );
}
