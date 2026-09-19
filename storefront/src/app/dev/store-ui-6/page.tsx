"use client";

import { notFound } from "next/navigation";
import { ExperienceBuilder } from "@/components/customizer/ExperienceBuilder";

/**
 * Development-only visual harness for STORE-UI-6. Not linked from the
 * storefront, not found in production. The merchant workspace mounts the
 * same builder at /commerce/appearance.
 */
export default function StoreUi6PreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="h-screen bg-neutral-200 [height:100dvh]">
      <ExperienceBuilder initialLocale="ar" liveStoreName="متجر النور" />
    </div>
  );
}
