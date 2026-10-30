'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/nebrax';
import { QuotationsSection } from '@/modules/commerce-workspace/wholesale/sections/quotations/quotations-section';

export default function WholesaleQuotationsSectionPage() {
  return (
    <Suspense fallback={<LoadingState variant="table" rows={5} />}>
      <QuotationsSection />
    </Suspense>
  );
}
