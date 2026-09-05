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
  /**
   * PR-2S: غائبة كلياً عن استجابة `/pos/products` — لا `null`، لا صفر — ما لم
   * يجتمع للمستخدم صلاحية `products.view_cost` **وإعداد** `show_cost_profit_in_pos`
   * معاً على الخادم. الغياب هنا يعني «غير مُصرَّح»، لا «القيمة صفر». لا تُشتق
   * هذه القيم من سعر البيع أو من بعضها هنا مهما بدا ذلك ممكناً حسابياً — أي
   * اشتقاق كهذا يُعيد نفس الثغرة الأمنية التي أُغلقت خادمياً في PR-2S.
   */
  purchase_price?: string;
  avg_cost?: string;
  profit_margin?: number | null;
}

/**
 * معاينة منتج للقراءة فقط داخل POS. لا تُنشئ أو تعدّل شيئاً — لا سلة، لا سعراً،
 * لا مخزوناً. تعرض فقط ما يصل بالفعل من كتالوج POS نفسه (`/pos/products`).
 * قسم «معلومات تجارية» (تكلفة/سعر شراء/هامش) يظهر فقط حين يعيدها الخادم فعلاً؛
 * الخادم وحده — عبر صلاحية `products.view_cost` وإعداد `show_cost_profit_in_pos`
 * معاً (PR-2S) — يقرر ذلك. لا فحص صلاحية هنا، ولا قيمة احتياطية أو محسوبة.
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
    commercialSection: string;
    purchasePrice: string;
    avgCost: string;
    profitMargin: string;
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

        {(product.purchase_price !== undefined || product.avg_cost !== undefined || product.profit_margin !== undefined) && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{fields.commercialSection}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              {product.purchase_price !== undefined && (
                <div className="min-w-0">
                  <dt className="text-xs text-muted">{fields.purchasePrice}</dt>
                  <dd className="num truncate text-text">{product.purchase_price}</dd>
                </div>
              )}
              {product.avg_cost !== undefined && (
                <div className="min-w-0">
                  <dt className="text-xs text-muted">{fields.avgCost}</dt>
                  <dd className="num truncate text-text">{product.avg_cost}</dd>
                </div>
              )}
              {product.profit_margin !== undefined && product.profit_margin !== null && (
                <div className="min-w-0">
                  <dt className="text-xs text-muted">{fields.profitMargin}</dt>
                  <dd className="num truncate text-text">{product.profit_margin}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

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
