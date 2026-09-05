'use client';

import Link from 'next/link';
import { Barcode as BarcodeIcon, ExternalLink } from 'lucide-react';
import { PosDialog } from '@/components/pos/pos-dialog';
import { PosProductImage } from '@/components/pos/pos-product-image';

export interface PosProductQuickViewProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode?: string | null;
  category: string | null;
  sale_price_label: string;
  pos_image?: { download_url: string } | null;
  track_inventory: boolean;
  quantity_on_hand: number;
  units: ReadonlyArray<{ name: string; factor: number }>;
}

/**
 * معاينة منتج للقراءة فقط داخل POS. لا تُنشئ أو تعدّل شيئاً — لا سلة، لا سعراً،
 * لا مخزوناً. تعرض فقط ما يصل بالفعل من كتالوج POS نفسه (`/pos/products`)؛
 * لا تعرض التكلفة أو سعر الشراء أو هامش الربح مهما توفّرت في الكائن الخام —
 * هذه بيانات حسّاسة يُقرّر كشفها من صلاحية الخادم لا من إخفاء الواجهة (انظر
 * تنبيه الأمان في تقرير PR-2: `ProductResource` يعيدها اليوم دون حارس صلاحية
 * مخصّص، وإصلاح ذلك تغيير خلفي خارج نطاق هذا PR).
 */
export function PosProductQuickView({
  open,
  onClose,
  product,
  title,
  fields,
  openInErpHref,
  openInErpLabel,
}: {
  open: boolean;
  onClose: () => void;
  product: PosProductQuickViewProduct | null;
  title: string;
  fields: {
    sku: string;
    barcode: string;
    category: string;
    units: string;
    stock: string;
    outOfStock: string;
    inStock: string;
  };
  /** يُمرَّر فقط حين يتوفر مسار ERP حقيقي لهذا المنتج؛ لا رابط وهمي. */
  openInErpHref?: string;
  openInErpLabel?: string;
}) {
  if (!product) return null;

  return (
    <PosDialog open={open} onClose={onClose} title={title} className="max-w-md">
      <div className="space-y-4">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-background">
          <PosProductImage path={product.pos_image?.download_url} alt={product.name} />
        </div>

        <div>
          <h3 className="text-base font-semibold leading-snug text-text">{product.name}</h3>
          <p className="num mt-1 text-lg font-extrabold text-text">{product.sale_price_label}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          {product.sku && (
            <div className="min-w-0">
              <dt className="text-xs text-muted">{fields.sku}</dt>
              <dd className="truncate text-text">{product.sku}</dd>
            </div>
          )}
          {product.barcode && (
            <div className="min-w-0">
              <dt className="text-xs text-muted">{fields.barcode}</dt>
              <dd className="num flex items-center gap-1 truncate text-text" dir="ltr">
                <BarcodeIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
                {product.barcode}
              </dd>
            </div>
          )}
          {product.category && (
            <div className="min-w-0">
              <dt className="text-xs text-muted">{fields.category}</dt>
              <dd className="truncate text-text">{product.category}</dd>
            </div>
          )}
          {product.units.length > 0 && (
            <div className="min-w-0">
              <dt className="text-xs text-muted">{fields.units}</dt>
              <dd className="truncate text-text">{product.units.map((u) => u.name).join('، ')}</dd>
            </div>
          )}
          {product.track_inventory && (
            <div className="min-w-0 col-span-2">
              <dt className="text-xs text-muted">{fields.stock}</dt>
              <dd className={'num text-text ' + (product.quantity_on_hand <= 0 ? 'font-semibold text-negative' : '')}>
                {product.quantity_on_hand <= 0 ? fields.outOfStock : `${fields.inStock}: ${product.quantity_on_hand}`}
              </dd>
            </div>
          )}
        </dl>

        {openInErpHref && (
          <Link
            href={openInErpHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold text-text hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.7} />
            {openInErpLabel}
          </Link>
        )}
      </div>
    </PosDialog>
  );
}
