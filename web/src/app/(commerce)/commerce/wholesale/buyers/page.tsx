'use client';

import { SectionPage } from '@/modules/commerce-workspace/wholesale/components/section-page';
import { BuyersSection } from '@/modules/commerce-workspace/wholesale/sections/buyers/buyers-section';

/** Wholesale · Buyers & Companies — membership review (H6 Batch E staff API). */
export default function WholesaleBuyersPage() {
  return (
    <SectionPage sectionKey="buyers">
      <BuyersSection />
    </SectionPage>
  );
}
