'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatRiyal } from '@/lib/money';

export interface Receipt {
  number: string;
  total: string;
  qr: string | null;
  /** تذييل الإيصال — من إعدادات نقطة البيع (receipt_footer). */
  footer?: string | null;
}

/**
 * حوار إيصال ما بعد البيع. `autoPrint` (من إعداد print_receipt) يطلق الطباعة
 * تلقائياً مرّة واحدة عند ظهور الإيصال — أفضل جهد (بعض المتصفّحات تتطلّب تفاعلاً).
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
    // طباعة مرّة واحدة لكل إيصال (يمنع التكرار عند إعادة الرسم).
    if (printedFor.current === receipt.number) return;
    printedFor.current = receipt.number;
    const id = window.setTimeout(() => {
      try { window.print(); } catch { /* تجاهل — الزرّ متاح يدوياً */ }
    }, 250);
    return () => window.clearTimeout(id);
  }, [receipt, autoPrint]);

  if (!receipt) return null;

  return (
    <Dialog open={!!receipt} onClose={onClose} title={t('receipt')} className="max-w-xs">
      <div className="flex flex-col items-center gap-3 text-center print-receipt">
        <div className="text-sm text-muted">{t('receipt_done')}</div>
        <div className="num text-lg font-semibold text-text">{receipt.number}</div>
        <div className="num text-2xl font-bold text-text">{formatRiyal(receipt.total)}</div>
        {receipt.qr && (
          <div className="rounded bg-white p-3">
            <QRCodeSVG value={receipt.qr} size={130} level="M" />
          </div>
        )}
        {receipt.footer && receipt.footer.trim() !== '' && (
          <div className="mt-1 whitespace-pre-line text-[11px] text-muted">{receipt.footer}</div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2 no-print">
        <Button variant="outline" onClick={onClose}>
          {t('new_sale')}
        </Button>
        <Button onClick={() => window.print()}>{t('print')}</Button>
      </div>
    </Dialog>
  );
}
