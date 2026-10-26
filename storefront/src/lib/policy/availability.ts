import { POLICY_SLUGS, type PolicySlug } from "./slugs";

/**
 * X4-FIX — `policy_availability` from `GET store/v1/storefront`: slug ⇒ "the policy endpoint would serve this
 * storefront a visible, published, enabled policy". Computed by the backend from the published snapshot with the
 * same rules as `GET store/v1/policies/{slug}`; it carries booleans only, never text.
 *
 * FAIL CLOSED: a missing, malformed or older payload yields all `false` (links hidden), and only a literal `true`
 * counts. A link is therefore shown only when both the merchant enabled the page AND the backend vouched for content.
 */
export type PolicyAvailability = Readonly<Record<PolicySlug, boolean>>;

export function readPolicyAvailability(raw: unknown): PolicyAvailability {
  const source =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    POLICY_SLUGS.map((slug) => [slug, source[slug] === true]),
  ) as Record<PolicySlug, boolean>;
}
