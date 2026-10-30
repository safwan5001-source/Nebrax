'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/nebrax';
import { OffersSection } from '@/modules/commerce-workspace/wholesale/sections/offers/offers-section';

export default function WholesaleOffersSectionPage() {
  return (
    <Suspense fallback={<LoadingState variant="table" rows={5} />}>
      <OffersSection />
    </Suspense>
  );
}
