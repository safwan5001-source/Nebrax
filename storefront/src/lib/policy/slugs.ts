/** X4 — the four policy slugs the AWJ API serves (B8). Shared by the data layer, footer and navigation. */
export const POLICY_SLUGS = [
  "shipping-policy",
  "privacy-policy",
  "returns-policy",
  "terms-of-service",
] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

export function isPolicySlug(slug: string): slug is PolicySlug {
  return (POLICY_SLUGS as readonly string[]).includes(slug);
}
