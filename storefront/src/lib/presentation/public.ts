/**
 * STORE-BACKEND-1 — helpers for applying a Published presentation on the
 * public storefront. Draft is unreachable here.
 */

import type {
  PresentationNavLink,
  StorefrontPresentationConfig,
} from "./config";
import { normalizePresentationConfig, previewStoreName } from "./config";
import { presentationCssVars } from "./tokens";
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

export function publishedThemeStyle(
  presentation: StorefrontPresentationConfig | null,
): Record<string, string> | undefined {
  if (!presentation) return undefined;
  return presentationCssVars(presentation.primaryColor, presentation.radius);
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
