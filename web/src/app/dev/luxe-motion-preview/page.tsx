'use client';

import { notFound, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { StorefrontPreviewCanvas } from '@/modules/store-experience-builder/StorefrontPreviewCanvas';
import { DEFAULT_PRESENTATION_CONFIG } from '@/modules/store-experience-builder/presentation/config';
import type {
  CategoryPageRegionKey,
  PageRegionInstance,
  ProductPageRegionKey,
} from '@/modules/store-experience-builder/presentation/page-regions';
import { applyTheme, builtInTheme } from '@/modules/store-experience-builder/themes';

/**
 * AWJ Luxe Motion QA — development-only fixture. Mounts the REAL `StorefrontPreviewCanvas` (the component the
 * Customizer renders) for the product / category page with the config a merchant gets after "Apply theme", so its
 * computed geometry can be compared in a real browser against the published storefront. The preview is an
 * illustrative canvas, not the public components. Production requests 404. Synthetic neutral data only.
 *
 *   /dev/luxe-motion-preview?page=product|category&preset=luxe|modern&locale=ar|en&viewport=mobile|desktop
 */

const IMAGE_BASE = process.env.NEXT_PUBLIC_LUXE_QA_IMAGE_BASE ?? 'http://127.0.0.1:4120/img';

const productRegions: PageRegionInstance<ProductPageRegionKey>[] = [
  { id: 'media_gallery', key: 'media_gallery', visible: true },
  { id: 'identity', key: 'identity', visible: true },
  { id: 'price', key: 'price', visible: true },
  { id: 'quantity_cta', key: 'quantity_cta', visible: true },
];
const categoryRegions: PageRegionInstance<CategoryPageRegionKey>[] = [
  { id: 'product_grid', key: 'product_grid', visible: true },
];

function Fixture() {
  const params = useSearchParams();
  const locale = params.get('locale') === 'en' ? 'en' : 'ar';
  const viewport = params.get('viewport') === 'desktop' ? 'desktop' : 'mobile';
  const page = params.get('page') === 'category' ? 'category' : 'product';
  const luxe = params.get('preset') !== 'modern';

  const theme = luxe ? builtInTheme('awj-luxe-motion') : undefined;
  const applied = theme ? applyTheme(DEFAULT_PRESENTATION_CONFIG, theme) : null;
  const config = applied && applied.ok ? applied.config : DEFAULT_PRESENTATION_CONFIG;

  const media = [1, 2, 3].map((n) => ({
    id: `m-${n}`,
    url: `${IMAGE_BASE}/${n}.svg`,
    thumbnailUrl: `${IMAGE_BASE}/${n}.svg`,
    alt: null,
    position: n,
  }));
  const previewProduct = {
    id: 'qa-1',
    name: 'Luxury Gift Box',
    nameEn: 'Luxury Gift Box',
    description: 'Neutral QA description',
    sku: 'QA-P1',
    categoryName: 'Gifts',
    priceAmountMinor: 24900,
    currency: 'SAR',
    inStock: true,
    media,
    isVariantManaged: false,
    options: null,
    variants: null,
  };
  const gridProducts = [1, 2, 3, 4].map((n) => ({
    id: `g-${n}`,
    name: n === 3 ? 'Complete Contemporary Home Decor Collection Including Candle Holders and Serving Plates' : `Product ${n}`,
    thumbnailUrl: `${IMAGE_BASE}/${n}.svg`,
    priceAmountMinor: 12900 + n * 1000,
    currency: 'SAR',
    inStock: true,
  }));
  const category = { id: 'cat-1', name: 'Gifts', description: null, parentId: null, children: [], ancestors: [] };

  return (
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} data-qa-preview={page} style={{ width: viewport === 'mobile' ? 390 : 1100, marginInline: 'auto' }}>
      {page === 'product' ? (
        <StorefrontPreviewCanvas
          config={config}
          locale={locale}
          viewport={viewport}
          page="product"
          productPreviewState="ready"
          previewProduct={previewProduct}
          productRegions={productRegions}
        />
      ) : (
        <StorefrontPreviewCanvas
          config={config}
          locale={locale}
          viewport={viewport}
          page="category"
          categoryPreviewState="ready"
          previewCategory={category}
          categoryRegions={categoryRegions}
          categoryGridProductsState="ready"
          categoryGridProducts={gridProducts}
          categoryGridProductsTotal={gridProducts.length}
        />
      )}
    </div>
  );
}

export default function LuxeMotionPreviewFixture() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}
