'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentModel } from '../../types';

/** رمز ZATCA (QR) — يُرسَم SVG آمناً؛ يُبقي مساحة فارغة حين لا يوجد رمز. */
export function DocQr({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const qr = model.qr?.value ?? null;

  return (
    <div className="flex flex-col items-center gap-1">
      {qr ? (
        <>
          <div className="rounded-lg border border-gray-200 p-2">
            <QRCodeSVG value={qr} size={110} level="M" />
          </div>
          <div className="text-[9px] text-gray-400">{model.qr?.note ?? t('zatca_note')}</div>
        </>
      ) : (
        <div />
      )}
    </div>
  );
}
