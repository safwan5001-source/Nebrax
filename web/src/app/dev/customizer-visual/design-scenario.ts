import {
  type StorefrontPresentationConfig,
  normalizePresentationConfig,
} from "@/modules/store-experience-builder/presentation/config";

/**
 * CUST-HV V5c — every section type that declares a design capability, each wearing a
 * different one (dark solid / dark gradient / light band / bordered card / full-bleed),
 * so the real-render proof can walk the DOM and check the text that is actually drawn.
 */
export function designConfig(
  base: StorefrontPresentationConfig,
  data: StorefrontPresentationConfig,
) {
  const designs: Record<string, unknown> = {
    // Sections whose own markup paints a dark surface: the design must *replace* it.
    hero: { background: { kind: "solid", color: { hex: "#fde68a" } }, spacing: { top: "sm", bottom: "sm", inner: "sm" } },
    wholesale: { background: { kind: "solid", color: { hex: "#e0f2fe" } }, spacing: { top: "sm", bottom: "sm", inner: "sm" } },
    "banner-1": { background: { kind: "solid", color: { role: "brand" } }, border: { width: "none" }, spacing: { top: "md", bottom: "md", inner: "md" }, radius: "lg" },
    "benefits-1": { background: { kind: "solid", color: { role: "surfaceAlt" } }, text: { heading: { hex: "#1e1b4b" } }, typography: { headingScale: "xl", headingWeight: 700, lineHeight: "relaxed", headingStyle: "underline" }, border: { width: "hairline" }, radius: "md", shadow: "soft", spacing: { top: "sm", bottom: "sm", inner: "sm" } },
    "custom-1": { background: { kind: "gradient", from: { hex: "#0b3d2e" }, to: { hex: "#1c2a6b" }, direction: "to-end" }, typography: { bodyScale: "lg", headingStyle: "centered" }, width: { max: "narrow" }, align: "center", spacing: { top: "lg", bottom: "lg", inner: "md" } },
    "featured-1": { background: { kind: "solid", color: { hex: "#101820" } }, typography: { headingStyle: "plain" }, width: { mode: "full" }, spacing: { top: "md", bottom: "md" } },
    "app-1": { background: { kind: "solid", color: { hex: "#fff3cd" } }, border: { width: "medium", color: { role: "brand" } }, radius: "pill", spacing: { top: "sm", bottom: "sm", inner: "md" } },
    "promise-1": { background: { kind: "solid", color: { hex: "#1e3a5f" } }, spacing: { top: "sm", bottom: "sm", inner: "sm" } },
    "shelf-1": { background: { kind: "solid", color: { hex: "#14532d" } }, spacing: { top: "md", bottom: "md", inner: "sm" } },
    "discovery-1": { background: { kind: "gradient", from: { hex: "#312e81" }, to: { hex: "#4c1d95" }, direction: "to-bottom" }, spacing: { top: "md", bottom: "md", inner: "sm" } },
  };
  const sections = [...base.homepage.sections, ...data.homepage.sections].map((section) => ({
    ...section,
    ...(designs[section.id] ? { design: designs[section.id] } : {}),
  }));
  return normalizePresentationConfig({ ...base, homepage: { ...base.homepage, sections } });
}

