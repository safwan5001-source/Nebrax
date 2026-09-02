'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { VISUAL_V2 } from '../../presentation/visual-v2';
import { ModernFieldLabel } from '../../presentation/modern-bilingual-label';

/** رمز ZATCA (QR) — يُرسَم SVG آمناً؛ يُبقي مساحة فارغة حين لا يوجد رمز. */
export function DocQr({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const { mode } = useDocumentLabelMode(model);
  const qr = model.qr?.value ?? null;
  const isModern = style.composition === 'modern';
  const size = isModern ? VISUAL_V2.qrSizePx : 110;

  return (
    <div className="flex flex-col items-center gap-1">
      {qr ? (
        <>
          <div className={isModern ? 'border border-[color:var(--border)] p-1' : 'rounded-lg border border-gray-200 p-2'}>
            <QRCodeSVG value={qr} size={size} level="M" />
          </div>
          <div className={isModern ? 'text-[9px] text-[color:var(--muted)]' : 'text-[9px] text-gray-400'}>
            {model.qr?.note ?? (isModern ? <ModernFieldLabel field="zatca_note" mode={mode} /> : t('zatca_note'))}
          </div>
        </>
      ) : (
        <div />
      )}
    </div>
  );
}
