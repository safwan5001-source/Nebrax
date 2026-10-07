import type { CSSProperties, ReactNode } from "react";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import {
  type DesignContext,
  resolveSectionDesign,
} from "@/lib/presentation/section-design-resolve";

/**
 * CUST-HV V5c — applies a section's merchant `design` (contract §3). A section
 * with no design is returned **untouched** — no wrapper, no attribute — so every
 * pre-V5 document renders byte-identically. Output is data attributes + validated
 * `--sec-*` custom properties only; the stylesheet does the rest.
 */
export function SectionDesignFrame({
  section,
  context,
  children,
}: {
  section: Pick<PresentationHomeSection, "type" | "design">;
  context: DesignContext;
  children: ReactNode;
}) {
  const resolved = resolveSectionDesign(section.type, section.design, context);
  if (!resolved) return <>{children}</>;
  return (
    <div {...resolved.attrs} style={resolved.style as CSSProperties}>
      {children}
    </div>
  );
}
