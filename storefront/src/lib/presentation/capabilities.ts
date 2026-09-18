import type { CapabilityState } from "@/lib/commerce/capabilities";

/**
 * STORE-UI-6 presentation capabilities.
 *
 * The Customizer designs the merchant experience now. Nothing here is LIVE
 * persistence: `storefronts` stores name + locale only, and there is no
 * presentation table, draft/publish API, branding media, contact, WhatsApp,
 * social, verification, app-link or CMS contract in store/v1.
 *
 * Page-lifetime draft state is allowed so the intended UX can be reviewed.
 * It must not be written to localStorage/sessionStorage/cookies, and Save /
 * Publish must never report success.
 */

export const THEME_PERSISTENCE_CAPABILITY = "design_only" as CapabilityState;
export const BRANDING_PERSISTENCE_CAPABILITY = "design_only" as CapabilityState;
export const HOMEPAGE_COMPOSITION_CAPABILITY = "design_only" as CapabilityState;
export const CUSTOM_NAV_LINKS_CAPABILITY = "design_only" as CapabilityState;
export const FOOTER_CONFIG_CAPABILITY = "design_only" as CapabilityState;
export const CONTACT_INFO_CAPABILITY = "design_only" as CapabilityState;
export const WHATSAPP_CAPABILITY = "design_only" as CapabilityState;
export const SOCIAL_LINKS_CAPABILITY = "design_only" as CapabilityState;
export const BUSINESS_VERIFICATION_CAPABILITY = "gated" as CapabilityState;
export const MOBILE_APP_LINKS_CAPABILITY = "design_only" as CapabilityState;
export const INFORMATIONAL_PAGES_CAPABILITY = "gated" as CapabilityState;
export const DRAFT_PERSISTENCE_CAPABILITY = "design_only" as CapabilityState;
export const CUSTOMIZER_PREVIEW_CAPABILITY = "design_only" as CapabilityState;
export const PUBLISH_CAPABILITY = "gated" as CapabilityState;
export const VERSION_HISTORY_CAPABILITY = "deferred" as CapabilityState;

/**
 * Missing backend contracts (do not invent; recorded for later activation):
 *
 * Theme / branding / homepage / footer / contact / WhatsApp / social / apps:
 *   GET  /api/commerce/workspace/storefronts/{id}/presentation
 *   PUT  /api/commerce/workspace/storefronts/{id}/presentation
 *     Auth: Sanctum + EnsureUserPrincipal + SetTenant + commerce.manage
 *     Tenant: TenantContext only; foreign {id} → 404
 *     Body: presentation-only. No product/category master data.
 *   GET  /store/v1/storefront  — extend published presentation onto the
 *     existing { name, default_locale } payload (or a sibling route).
 *     Host-resolved; fail closed to AWJ Modern defaults.
 *
 * Logo / favicon media:
 *   a tenant-scoped branding media object, not ERP company.logo and not
 *   product GET store/v1/media/{id}.
 *
 * Business verification:
 *   an AWJ-or-external verified status. Merchant-typed CR numbers / URLs
 *   are never sufficient for a Verified badge.
 *
 * Informational pages:
 *   GET/PUT store/v1/pages/{slug} (or workspace equivalent). Spree
 *   policies.get is not an AWJ contract.
 *
 * Draft / publish:
 *   presentation revisions with status draft | published, preview-before-
 *   publish, and publish that does not mutate the live storefront until
 *   an authoritative publish call succeeds.
 *
 * Version history / restore:
 *   list previous published revisions and restore. Nothing is built.
 */
export const STORE_UI_6_CAPABILITIES = {
  themePersistence: THEME_PERSISTENCE_CAPABILITY,
  brandingPersistence: BRANDING_PERSISTENCE_CAPABILITY,
  homepageComposition: HOMEPAGE_COMPOSITION_CAPABILITY,
  customNavLinks: CUSTOM_NAV_LINKS_CAPABILITY,
  footerConfiguration: FOOTER_CONFIG_CAPABILITY,
  contactInformation: CONTACT_INFO_CAPABILITY,
  whatsapp: WHATSAPP_CAPABILITY,
  socialLinks: SOCIAL_LINKS_CAPABILITY,
  businessVerification: BUSINESS_VERIFICATION_CAPABILITY,
  mobileAppLinks: MOBILE_APP_LINKS_CAPABILITY,
  informationalPages: INFORMATIONAL_PAGES_CAPABILITY,
  draftPersistence: DRAFT_PERSISTENCE_CAPABILITY,
  preview: CUSTOMIZER_PREVIEW_CAPABILITY,
  publish: PUBLISH_CAPABILITY,
  versionHistory: VERSION_HISTORY_CAPABILITY,
} as const;
