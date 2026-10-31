'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/nebrax';
import { CatalogSection } from '@/modules/commerce-workspace/wholesale/sections/catalog/catalog-section';

export default function WholesaleCatalogSectionPage() {
  return (
    <Suspense fallback={<LoadingState variant="table" rows={5} />}>
      <CatalogSection />
    </Suspense>
  );
}
