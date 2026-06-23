'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatRiyal } from '@/lib/money';

export interface Receipt {
  number: string;
  total: string;
  qr: string | null;
}

export function ReceiptDialog({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  const t = useTranslations('pos');
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
