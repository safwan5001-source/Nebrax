'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/nebrax';
import { SectionPage } from '@/modules/commerce-workspace/wholesale/components/section-page';
import { OrdersSection } from '@/modules/commerce-workspace/wholesale/sections/orders/orders-section';

/** Wholesale · Orders — staff orders endpoint locked to the wholesale channel (read-only; actions on the full order page). */
export default function WholesaleOrdersPage() {
  return (
    <SectionPage sectionKey="orders">
      <Suspense fallback={<LoadingState variant="table" rows={5} />}>
        <OrdersSection />
      </Suspense>
    </SectionPage>
  );
}
