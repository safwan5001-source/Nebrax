'use client';

import { SectionPage } from '@/modules/commerce-workspace/wholesale/components/section-page';
import { OverviewSection } from '@/modules/commerce-workspace/wholesale/sections/overview/overview-section';

/** Wholesale · Overview — readiness, alerts and (when active and permitted) real indicators. */
export default function WholesaleOverviewPage() {
  return (
    <SectionPage sectionKey="overview">
      <OverviewSection />
    </SectionPage>
  );
}
