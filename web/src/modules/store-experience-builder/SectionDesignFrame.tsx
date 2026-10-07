import type { CSSProperties, ReactNode } from "react";
import type { PresentationHomeSection } from "./presentation/config";
import {
  type DesignContext,
  resolveSectionDesign,
} from "./presentation/section-design-resolve";

/**
 * CUST-HV V5c — Canvas twin of the storefront's `SectionDesignFrame`. A section
 * with no design is returned untouched (no wrapper, no attribute); otherwise the
 * same pure resolver produces the same data attributes and `--sec-*` variables the
 * published page gets, so the Canvas shows what will be published.
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
