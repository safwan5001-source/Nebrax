export type CapabilityState = "live" | "design_only" | "gated" | "deferred";

/**
 * STORE-BACKEND-1 presentation capabilities.
 *
 * Persistence is live for the closed token set, homepage implemented keys,
 * chrome fields, draft GET/PUT, in-workspace preview, and publish. Branding
 * still round-trips data URLs only (no media object). Verification and
 * informational pages stay GATED. Version history stays DEFERRED.
 *
 * Merchant-entered CR / license / URL / requestedVerifiedLabel MUST NOT mint
 * a Verified badge. Preview remains the authenticated in-workspace canvas —
 * no token, no unpublished public route, no iframe of the live store.
 */

export const THEME_PERSISTENCE_CAPABILITY = "live" as CapabilityState;
export const BRANDING_PERSISTENCE_CAPABILITY = "design_only" as CapabilityState;
export const HOMEPAGE_COMPOSITION_CAPABILITY = "live" as CapabilityState;
export const CUSTOM_NAV_LINKS_CAPABILITY = "live" as CapabilityState;
export const FOOTER_CONFIG_CAPABILITY = "live" as CapabilityState;
export const CONTACT_INFO_CAPABILITY = "live" as CapabilityState;
export const WHATSAPP_CAPABILITY = "live" as CapabilityState;
export const SOCIAL_LINKS_CAPABILITY = "live" as CapabilityState;
export const BUSINESS_VERIFICATION_CAPABILITY = "gated" as CapabilityState;
export const MOBILE_APP_LINKS_CAPABILITY = "live" as CapabilityState;
export const INFORMATIONAL_PAGES_CAPABILITY = "gated" as CapabilityState;
export const DRAFT_PERSISTENCE_CAPABILITY = "live" as CapabilityState;
export const CUSTOMIZER_PREVIEW_CAPABILITY = "live" as CapabilityState;
export const PUBLISH_CAPABILITY = "live" as CapabilityState;
export const VERSION_HISTORY_CAPABILITY = "deferred" as CapabilityState;

/**
 * Remaining contracts (do not invent in this slice):
 *
 * Logo / favicon media:
 *   a tenant-scoped branding media object, not ERP company.logo and not
 *   product GET store/v1/media/{id}. Data URLs round-trip until then.
 *
 * Business verification:
 *   an AWJ-or-external verified status. Merchant-typed CR numbers / URLs
 *   are never sufficient for a Verified badge.
 *
 * Informational pages:
 *   GET/PUT store/v1/pages/{slug} (or workspace equivalent). Spree
 *   policies.get is not an AWJ contract.
 *
 * Version history / restore:
 *   list previous published revisions and restore. Nothing is built.
 *
 * Preview token / unpublished public storefront:
 *   not this slice. The in-workspace canvas is the designed preview.
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
