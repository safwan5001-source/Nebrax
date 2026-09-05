'use client';

import { Barcode, Info, Star } from 'lucide-react';
import { PosProductImage } from '@/components/pos/pos-product-image';
import { cn } from '@/lib/utils';

export interface PosProductTileProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode?: string | null;
  sale_price_label: string;
  pos_image?: { download_url: string } | null;
  track_inventory: boolean;
  quantity_on_hand: number;
  /** حد إعادة الطلب من بطاقة المنتج نفسها (نفس عتبة «مخزون منخفض» في قائمة
   *  المنتجات: `quantity_on_hand <= reorder_level` و`reorder_level > 0`). عرضٌ
   *  بحت لا يغيّر أهلية الإضافة — الخادم وحده يقرّر عند الترحيل. */
  reorder_level?: number | null;
}

/** بطاقة منتج POS: كامل المساحة قابلة للضغط لإضافة الصنف. */
export function PosProductTile({
  product,
  showImage,
  selected,
  isFavorite,
  availableLabel,
  favoriteLabel,
  outOfStockLabel,
  lowStockLabel,
  quickViewLabel,
  onAdd,
  onToggleFavorite,
  onOpenQuickView,
  onFocus,
  buttonRef,
}: {
  product: PosProductTileProduct;
  showImage: boolean;
  selected: boolean;
  isFavorite: boolean;
  availableLabel: string;
  favoriteLabel: string;
  outOfStockLabel?: string;
  lowStockLabel?: string;
  quickViewLabel?: string;
  onAdd: () => void;
  onToggleFavorite: () => void;
  /** اختياري: زر معلومات مستقل يفتح Quick View للقراءة فقط. لا يضيف للسلة. */
  onOpenQuickView?: () => void;
  onFocus: () => void;
  buttonRef?: (element: HTMLButtonElement | null) => void;
}) {
  const outOfStock = product.track_inventory && product.quantity_on_hand <= 0;
  const lowStock = !outOfStock && product.track_inventory
    && typeof product.reorder_level === 'number' && product.reorder_level > 0
    && product.quantity_on_hand <= product.reorder_level;
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
          'group flex w-full touch-manipulation select-none flex-col overflow-hidden rounded-lg border bg-surface text-start',
          'transition-[border-color,background-color] duration-150 hover:border-primary active:border-primary active:bg-primary-soft',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          selected ? 'border-primary ring-2 ring-primary/40' : 'border-border',
          showImage ? 'min-h-[172px]' : 'min-h-32',
        )}
      >
        {showImage && (
          <div className={'w-full overflow-hidden border-b border-border bg-background ' + (product.pos_image?.download_url ? 'aspect-[4/3]' : 'h-12')}>
            <PosProductImage path={product.pos_image?.download_url} alt={product.name} />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <span className="line-clamp-2 min-h-10 text-sm font-semibold leading-snug text-text">{product.name}</span>

          <span className="num mt-2 min-w-0 truncate text-[15px] font-extrabold text-text" title={product.sale_price_label}>
            {product.sale_price_label}
          </span>

          <div className="mt-auto min-w-0 space-y-1.5 border-t border-border pt-2 text-[10px] text-muted">
            {product.barcode ? (
              <span className="flex min-w-0 items-center gap-1" title={product.barcode} data-testid="pos-product-barcode">
                <Barcode className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                <span className="num min-w-0 truncate" dir="ltr">{product.barcode}</span>
              </span>
            ) : null}
            {product.track_inventory && (
              <span
                className={cn(
                  'num block truncate whitespace-nowrap',
                  outOfStock ? 'font-semibold text-negative' : lowStock ? 'font-semibold text-warning' : undefined,
                )}
                data-testid="pos-product-stock"
              >
                {outOfStock && outOfStockLabel ? outOfStockLabel : `${availableLabel}: ${product.quantity_on_hand}`}
                {!outOfStock && lowStock && lowStockLabel ? ` · ${lowStockLabel}` : ''}
              </span>
            )}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
        className={cn(
          'absolute end-2 top-2 grid min-h-11 min-w-11 touch-manipulation place-items-center rounded-md border border-border bg-surface/95',
          'hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          isFavorite ? 'text-warning' : 'text-muted',
        )}
        aria-label={favoriteLabel}
      >
        <Star className="h-4 w-4" strokeWidth={1.7} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>

      {onOpenQuickView && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenQuickView();
          }}
          className={cn(
            'absolute start-2 top-2 grid min-h-11 min-w-11 touch-manipulation place-items-center rounded-md border border-border bg-surface/95 text-muted',
            'hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          )}
          aria-label={quickViewLabel}
        >
          <Info className="h-4 w-4" strokeWidth={1.7} />
        </button>
      )}
    </div>
  );
}
