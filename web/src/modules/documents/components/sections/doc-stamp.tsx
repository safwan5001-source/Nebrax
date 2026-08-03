'use client';

import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';

/** ختم الشركة — صورة (يُحاذى للنهاية). لا يظهر بلا صورة. */
export function DocStamp({ model }: { model: DocumentModel }) {
  const style = useDocStyle();
  if (!model.stampUrl) return null;

  return (
    <div className={cn('flex justify-end', style.sectionGap)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
      <img src={model.stampUrl} alt="stamp" className="h-24 w-auto object-contain opacity-90" />
    </div>
  );
}
