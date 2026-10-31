'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/nebrax';
import { PriceListsSection } from '@/modules/commerce-workspace/wholesale/sections/price-lists/price-lists-section';

export default function WholesalePriceListsSectionPage() {
  return (
    <Suspense fallback={<LoadingState variant="table" rows={5} />}>
      <PriceListsSection />
    </Suspense>
  );
}
