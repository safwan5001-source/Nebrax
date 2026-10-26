import { cache } from "react";
import { StorefrontApiError, storefrontFetch } from "@/lib/commerce/config";
import { assertSafePolicyHtml } from "@/lib/policy/safe-html";
import { isPolicySlug, type PolicySlug } from "@/lib/policy/slugs";

export {
  isPolicySlug,
  POLICY_SLUGS,
  type PolicySlug,
} from "@/lib/policy/slugs";

/**
 * X4 — public store policy pages, read from the AWJ Store API (`GET store/v1/policies/{slug}`, B8-2).
 *
 * The backend resolves tenant + storefront from the visitor's real Host (forwarded by `storefrontFetch`)
 * and returns ONLY a published, enabled, non-empty policy, already Markdown→HTML sanitized. Anything
 * else is one uniform `404`. This module never reads drafts and has no Spree dependency.
 *
 * Deliberately NOT cached across requests (no `"use cache"`, no module state): a cache key that omits
 * the host would serve one tenant's legal text to another. `react`'s `cache()` memoises within a single
 * request only (page + `generateMetadata` share one fetch) and is discarded afterwards.
 *
 * No `"use server"` directive: these are server-internal readers, not callable server actions.
 */

export interface AwjPolicy {
  slug: PolicySlug;
  /** The language actually served (`ar` | `en`) — may differ from the requested one. */
  locale: "ar" | "en";
  /** True when the requested language had no text and another was served. */
  fallback: boolean;
  title: string;
  /** Backend-sanitized HTML, re-verified against a strict allowlist before it is returned. */
  html: string;
}

/**
 * The AWJ API could not give a definitive answer (5xx, 429, network, malformed payload, unsafe HTML).
 * Distinct from a genuine "no such policy" (`null`). The message is generic on purpose: it can reach
 * the framework's error boundary, and must never carry upstream/internal detail.
 */
export class PolicyUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Policy page is temporarily unavailable.", options);
    this.name = "PolicyUnavailableError";
  }
}

const SERVED_LOCALES = ["ar", "en"] as const;

function isServedLocale(value: unknown): value is "ar" | "en" {
  return (SERVED_LOCALES as readonly unknown[]).includes(value);
}

interface PolicyEnvelope {
  data?: {
    slug?: unknown;
    locale?: unknown;
    fallback?: unknown;
    title?: unknown;
    html?: unknown;
  };
}

async function readPolicy(
  slug: string,
  locale: string | undefined,
): Promise<AwjPolicy | null> {
  if (!isPolicySlug(slug)) return null;

  let envelope: PolicyEnvelope;
  try {
    envelope = await storefrontFetch<PolicyEnvelope>(
      `policies/${encodeURIComponent(slug)}`,
      { locale: locale === "ar" || locale === "en" ? locale : undefined },
      { cache: "no-store" },
    );
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) {
      return null;
    }
    throw new PolicyUnavailableError({ cause: error });
  }

  const data = envelope?.data;
  if (
    !data ||
    data.slug !== slug ||
    !isServedLocale(data.locale) ||
    typeof data.html !== "string" ||
    data.html.trim() === ""
  ) {
    throw new PolicyUnavailableError();
  }

  try {
    assertSafePolicyHtml(data.html);
  } catch (error) {
    throw new PolicyUnavailableError({ cause: error });
  }

  return {
    slug,
    locale: data.locale,
    fallback: data.fallback === true,
    title: typeof data.title === "string" ? data.title : "",
    html: data.html,
  };
}

const readPolicyOncePerRequest = cache(readPolicy);

/**
 * `null` = the policy does not exist for this storefront (missing / disabled / unpublished / empty).
 * Throws {@link PolicyUnavailableError} when the AWJ API could not answer.
 */
export async function getPolicy(
  slug: string,
  options: { locale?: string } = {},
): Promise<AwjPolicy | null> {
  return readPolicyOncePerRequest(slug, options.locale);
}
