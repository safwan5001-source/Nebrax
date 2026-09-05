'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Copy, TriangleAlert } from 'lucide-react';
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
  variant = 'success',
  onCopy,
}: {
  receipt: Receipt | null;
  autoPrint?: boolean;
  paperSize?: ReceiptPaperSize;
  onClose: () => void;
  /**
   * PR-4: 'success' (الافتراضي) هو سلوك R5 الأصلي بعد بيع ناجح فوراً — لم
   * يتغيّر حرفاً. 'preview' يُستهلك من مركز الفواتير لإعادة طباعة مستند
   * تاريخي: يستبدل إطار «تم البيع» بعنوان محايد ويستبدل زر «بيع جديد» بـ
   * «إغلاق» — العرض والطباعة والبيانات نفسها تماماً.
   */
  variant?: 'success' | 'preview';
  /** PR-4: نسخ رقم الفاتورة — قدرة متصفح حقيقية (`navigator.clipboard`)، لا محاكاة عتاد. */
  onCopy?: () => void;
}) {
  const t = useTranslations('pos');
  const printedFor = useRef<string | null>(null);
  const [printError, setPrintError] = useState(false);
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
    setPrintError(false);
  }, [receipt?.number]);

  /**
   * فشل الطباعة لا يعني فشل البيع أبداً (§8) — هذا زرٌّ لاحقٌ للبيع الناجح
   * فعلاً، ولا يُعيد الدفع ولا يُنشئ فاتورة أخرى مهما فشل. الفشل الحقيقي
   * الوحيد القابل للرصد هنا هو غياب جذر الطباعة (`#print-root`)؛ لا نتظاهر
   * بحالة طابعة لا نعرفها.
   */
  function handlePrint() {
    try {
      if (typeof document !== 'undefined' && !document.getElementById('print-root')) {
        setPrintError(true);
        return;
      }
      printDocument(format.paper);
      setPrintError(false);
    } catch {
      setPrintError(true);
    }
  }

  useEffect(() => {
    if (!receipt || !autoPrint) return;
    if (printedFor.current === receipt.number) return;
    printedFor.current = receipt.number;
    const id = window.setTimeout(() => {
      handlePrint();
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt, autoPrint, format.paper]);

  if (!receipt) return null;

  const totalMinor = receipt.model.totals?.total ?? 0;

  return (
    <PosDialog open={!!receipt} onClose={onClose} title={variant === 'preview' ? t('receipt_preview_title') : t('receipt')} className="max-w-md sm:max-w-lg">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3" data-testid={variant === 'preview' ? 'pos-receipt-preview' : 'pos-receipt-success'}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              {variant === 'success' && <CheckCircle2 className="h-5 w-5 shrink-0 text-positive" strokeWidth={1.7} aria-hidden />}
              {variant === 'success' ? t('receipt_done') : t('receipt_preview_title')}
            </div>
            <p className="num mt-1 truncate text-sm font-semibold text-text">{receipt.number}</p>
          </div>
          <div className="shrink-0 text-end">
            <div className="text-[11px] font-semibold text-muted">{t('total')}</div>
            <div className="num text-lg font-bold text-text">{formatRiyal(totalMinor / 100)}</div>
          </div>
        </div>

        {printError && (
          <div className="flex items-center gap-2 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative" role="alert" data-testid="pos-receipt-print-error">
            <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden />
            {t('print_failed')}
          </div>
        )}

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
            {variant === 'preview' ? t('close') : t('new_sale')}
          </Button>
          {variant === 'preview' && onCopy && (
            <Button variant="outline" className="min-h-11 touch-manipulation sm:min-w-28" onClick={onCopy}>
              <Copy className="h-4 w-4" strokeWidth={1.7} />
              {t('receipt_copy_number')}
            </Button>
          )}
          <Button className="min-h-11 touch-manipulation sm:min-w-28" onClick={handlePrint}>
            {t('print')}
          </Button>
        </div>
      </div>
    </PosDialog>
  );
}
