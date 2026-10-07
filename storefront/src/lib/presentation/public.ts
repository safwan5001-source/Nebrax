/**
 * STORE-BACKEND-1 — helpers for applying a Published presentation on the
 * public storefront. Draft is unreachable here.
 */

import type {
  PresentationNavLink,
  StorefrontPresentationConfig,
} from "./config";
import { normalizePresentationConfig, previewStoreName } from "./config";
import { resolveGlobalTokens } from "./global-tokens";
import { fontPresetFamilyStack, presentationCssVars } from "./tokens";
import { buildWhatsAppUrl, sanitizeExternalUrl, sanitizeLogoUrl } from "./urls";

export function readPublishedPresentation(
  raw: unknown,
): StorefrontPresentationConfig | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return normalizePresentationConfig(raw);
}

export function resolvePresentationHref(
  link: Pick<PresentationNavLink, "kind" | "href">,
  basePath: string,
): string | null {
  if (link.kind === "external") {
    return sanitizeExternalUrl(link.href);
  }
  const path = link.href.trim() || "/";
  if (/^https:\/\//i.test(path)) {
    return sanitizeExternalUrl(path);
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return basePath || "/";
  return `${basePath}${normalized}`;
}

export function publishedStoreName(
  presentation: StorefrontPresentationConfig | null,
  liveName: string | null,
  fallback: string,
): string {
  if (!presentation) {
    return liveName?.trim() || fallback;
  }
  return previewStoreName(presentation, liveName, fallback);
}

/**
 * CUST-H3-2-FIX-1 — `fontFamily` is set directly on this same returned
 * object (applied inline on `(storefront)/layout.tsx`'s theme wrapper div)
 * rather than through a CSS custom property a `globals.css` rule on `body`
 * would need to consume. `body` is an *ancestor* of that wrapper, and a
 * custom property set on a descendant never affects a property already
 * computed on an ancestor — so a `body { font-family: ...var(--store-font-
 * arabic)... }` rule could never see a value this wrapper set. Putting the
 * resolved stack directly on the wrapper's own `style` sidesteps that
 * entirely: the wrapper declares its own `font-family`, which every element
 * inside it (the whole published page) then inherits normally.
 */
export function publishedThemeStyle(
  presentation: StorefrontPresentationConfig | null,
): Record<string, string> | undefined {
  if (!presentation) return undefined;
  return {
    ...presentationCssVars(
      presentation.primaryColor,
      presentation.radius,
      presentation.accentColor,
    ),
    // CUST-HV V5e-2a — document-level global tokens (absent ⇒ nothing is added).
    ...(resolveGlobalTokens(presentation, presentation)?.style ?? {}),
    fontFamily: fontPresetFamilyStack(presentation.fontPreset),
  };
}

/**
 * CUST-HV V5e-2a — the `data-gt` token list for the same wrapper `publishedThemeStyle`
 * styles; `undefined` when no global token is set (the wrapper is exactly as before).
 */
export function publishedThemeAttrs(
  presentation: StorefrontPresentationConfig | null,
): Record<string, string> | undefined {
  const attrs = presentation
    ? resolveGlobalTokens(presentation, presentation)?.attrs
    : undefined;
  return attrs && Object.keys(attrs).length > 0 ? attrs : undefined;
}

export function publishedLogoUrl(
  presentation: StorefrontPresentationConfig | null,
  compact = false,
): string | null {
  if (!presentation) return null;
  const candidate =
    compact && presentation.branding.compactLogoDataUrl
      ? presentation.branding.compactLogoDataUrl
      : presentation.branding.logoDataUrl;
  return sanitizeLogoUrl(candidate);
}

export function publishedFaviconUrl(
  presentation: StorefrontPresentationConfig | null,
): string | null {
  if (!presentation) return null;
  return (
    sanitizeLogoUrl(presentation.branding.faviconDataUrl) ??
    publishedLogoUrl(presentation)
  );
}

export function publishedWhatsAppHref(
  presentation: StorefrontPresentationConfig | null,
  placement: "floating" | "footer",
): string | null {
  if (!presentation?.whatsapp.enabled) return null;
  const matches =
    presentation.whatsapp.placement === placement ||
    presentation.whatsapp.placement === "both";
  if (!matches) return null;
  return buildWhatsAppUrl(
    presentation.whatsapp.phone,
    presentation.whatsapp.message,
  );
}

export function publishedSocialLinks(
  presentation: StorefrontPresentationConfig | null,
): { id: string; network: string; href: string }[] {
  if (!presentation) return [];
  return presentation.social.flatMap((item) => {
    if (!item.enabled) return [];
    const href = sanitizeExternalUrl(item.url);
    return href ? [{ id: item.id, network: item.network, href }] : [];
  });
}

export function publishedExtraNav(
  presentation: StorefrontPresentationConfig | null,
  basePath: string,
): { id: string; label: string; href: string }[] {
  if (!presentation) return [];
  return presentation.header.links.flatMap((link) => {
    if (!link.enabled || !link.label.trim()) return [];
    const href = resolvePresentationHref(link, basePath);
    return href ? [{ id: link.id, label: link.label.trim(), href }] : [];
  });
}
