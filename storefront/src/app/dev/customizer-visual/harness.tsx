"use client";

import { ExperienceBuilder } from "@/components/customizer/ExperienceBuilder";
import type { StorefrontPresentationConfig } from "@/lib/presentation";

/** Read-only mount of the storefront /dev customizer mirror. Not authoritative. */
export function HarnessMirror({
  locale,
  config,
}: {
  locale: "ar" | "en";
  config: StorefrontPresentationConfig;
}) {
  return (
    <div
      className="h-screen bg-neutral-200 [height:100dvh]"
      data-visual-root=""
      data-surface="storefront-harness"
    >
      <ExperienceBuilder
        initialConfig={config}
        initialLocale={locale}
        liveStoreName={locale === "ar" ? "متجر النور" : "Al Noor"}
      />
    </div>
  );
}
