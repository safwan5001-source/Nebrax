'use client';

import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockJustifyClassName, useDocBlockProperties } from '../doc-block-properties-context';
import { getDocumentImagePreviewClass, getDocumentImagePreviewOpacityClass } from '../../utils/block-image-size';

/** ختم الشركة — صورة (يُحاذى للنهاية). لا يظهر بلا صورة. */
export function DocStamp({ model }: { model: DocumentModel }) {
  const style = useDocStyle();
  const properties = useDocBlockProperties('stamp');
  if (!model.stampUrl) return null;

  return (
    <div
      className={cn(
        'flex',
        blockJustifyClassName(properties),
        style.sectionGap,
        style.composition === 'erp' && 'border-t border-black pt-3',
        style.composition === 'erp_v2' && 'border-t border-black pt-3',
        style.composition === 'classic_v2' && 'border-t border-black pt-3',
        style.composition === 'minimal' && 'border-t border-black pt-3',
        style.composition === 'minimal_v2' && 'border-t border-[color:var(--border)] pt-3',
        style.composition === 'retail_v2' && 'border-t border-[color:var(--border)] pt-3',
        style.composition === 'quotation_proposal' && 'border-t border-[color:var(--border)] pt-3',
        style.composition === 'modern' && 'border-t border-[color:var(--border)] pt-3',
        style.composition === 'modern_v2' && 'border-t border-[color:var(--border)] pt-3',
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
      <img src={model.stampUrl} alt="stamp" className={cn(getDocumentImagePreviewClass('stamp', properties.image_size), getDocumentImagePreviewOpacityClass('stamp', properties.image_opacity))} />
    </div>
  );
}
