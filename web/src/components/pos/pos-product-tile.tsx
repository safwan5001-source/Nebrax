'use client';

import { Star } from 'lucide-react';
import { PosProductImage } from '@/components/pos/pos-product-image';
import { cn } from '@/lib/utils';

export interface PosProductTileProduct {
  id: string;
  name: string;
  sku: string | null;
  sale_price_label: string;
  pos_image?: { download_url: string } | null;
  track_inventory: boolean;
  quantity_on_hand: number;
}

/** بطاقة منتج POS: كامل المساحة قابلة للضغط لإضافة الصنف. */
export function PosProductTile({
  product,
  showImage,
  selected,
  isFavorite,
  taxLabel,
  availableLabel,
  favoriteLabel,
  onAdd,
  onToggleFavorite,
  onFocus,
  buttonRef,
}: {
  product: PosProductTileProduct;
  showImage: boolean;
  selected: boolean;
  isFavorite: boolean;
  taxLabel: string;
  availableLabel: string;
  favoriteLabel: string;
  onAdd: () => void;
  onToggleFavorite: () => void;
  onFocus: () => void;
  buttonRef?: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        ref={buttonRef}
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        onClick={onAdd}
        onFocus={onFocus}
        className={cn(
          'flex w-full touch-manipulation select-none flex-col rounded-lg border bg-surface p-2.5 text-start',
          'hover:border-primary active:border-primary active:bg-primary-soft',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          selected ? 'border-primary ring-2 ring-primary/40' : 'border-border',
          showImage ? '' : 'min-h-28 justify-between',
        )}
      >
        {showImage && (
          <div className={'mb-2.5 overflow-hidden rounded-md bg-background ' + (product.pos_image?.download_url ? 'aspect-[4/3]' : 'h-10')}>
            <PosProductImage path={product.pos_image?.download_url} alt={product.name} />
          </div>
        )}
        <span className="line-clamp-2 min-h-11 text-sm font-semibold leading-snug text-text">{product.name}</span>
        {product.sku && <span className="num mt-1 truncate text-[11px] text-muted">{product.sku}</span>}
        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="num text-sm font-bold text-primary">{product.sale_price_label}</span>
          {product.track_inventory && <span className="num text-[11px] text-muted">{availableLabel}: {product.quantity_on_hand}</span>}
        </div>
        <span className="mt-0.5 text-[10px] text-muted">{taxLabel}</span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
        className={cn(
          'absolute end-2 top-2 grid min-h-11 min-w-11 touch-manipulation place-items-center rounded-md bg-surface/90',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          isFavorite ? 'text-warning' : 'text-muted hover:text-primary',
        )}
        aria-label={favoriteLabel}
      >
        <Star className="h-4 w-4" strokeWidth={1.7} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}
