'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { useDocBlockProperties } from '../doc-block-properties-context';
import { getDocumentImagePreviewClass, getDocumentImagePreviewOpacityClass } from '../../utils/block-image-size';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { ModernFieldLabel } from '../../presentation/modern-bilingual-label';

/** التوقيع — صورة فوق خطّ توقيع. لا يظهر بلا صورة. */
export function DocSignature({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('signature');
  const { mode } = useDocumentLabelMode(model);
  const itemsAlignment = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
  }[properties.alignment ?? 'start'];
  if (!model.signatureUrl) return null;

  return (
    <div
      className={cn(
        'flex flex-col',
        itemsAlignment,
        style.sectionGap,
        style.composition === 'erp' && 'border-t border-black pt-3',
        style.composition === 'minimal' && 'border-t border-black pt-3',
        style.composition === 'modern' && 'border-t border-[color:var(--border)] pt-3',
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
      <img src={model.signatureUrl} alt={t('signature')} className={cn(getDocumentImagePreviewClass('signature', properties.image_size), getDocumentImagePreviewOpacityClass('signature', properties.image_opacity))} />
      <div className="mt-1 w-40 border-t border-[color:var(--muted)] pt-1 text-[10px] text-[color:var(--muted)]">
        {style.composition === 'modern' ? <ModernFieldLabel field="signature" mode={mode} /> : t('signature')}
      </div>
    </div>
  );
}
