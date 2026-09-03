'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { VISUAL_V2 } from '../../presentation/visual-v2';
import { ERP_V2 } from '../../presentation/erp-v2';
import { CLASSIC_V2 } from '../../presentation/classic-v2';
import { ModernFieldLabel } from '../../presentation/modern-bilingual-label';

/** رمز ZATCA (QR) — يُرسَم SVG آمناً؛ يُبقي مساحة فارغة حين لا يوجد رمز. */
export function DocQr({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const { mode } = useDocumentLabelMode(model);
  const qr = model.qr?.value ?? null;
  const isModernV2 = style.composition === 'modern_v2';
  const isErpV2 = style.composition === 'erp_v2';
  const isClassicV2 = style.composition === 'classic_v2';
  const usesV2Labels = isModernV2 || isErpV2 || isClassicV2;
  const size = isErpV2 ? ERP_V2.qrSizePx : isClassicV2 ? CLASSIC_V2.qrSizePx : isModernV2 ? VISUAL_V2.qrSizePx : 110;

  return (
    <div className="flex flex-col items-center gap-1">
      {qr ? (
        <>
          <div className={isErpV2 ? 'border border-black p-0.5' : isClassicV2 ? 'border border-black p-1' : isModernV2 ? 'border border-[color:var(--border)] p-1' : 'rounded-lg border border-gray-200 p-2'}>
            <QRCodeSVG value={qr} size={size} level="M" />
          </div>
          <div className={usesV2Labels ? 'text-[9px] text-[color:var(--muted)]' : 'text-[9px] text-gray-400'}>
            {model.qr?.note ?? (usesV2Labels ? <ModernFieldLabel field="zatca_note" mode={mode} /> : t('zatca_note'))}
          </div>
        </>
      ) : (
        <div />
      )}
    </div>
  );
}
