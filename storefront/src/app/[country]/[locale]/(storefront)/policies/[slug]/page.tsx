import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  type AwjPolicy,
  getPolicy,
  PolicyUnavailableError,
} from "@/lib/data/policies";
import { resolvePublishedStoreName } from "@/lib/metadata/store-identity";
import { buildCanonicalUrl } from "@/lib/seo";
import { getStoreUrl } from "@/lib/store";

interface PolicyPageProps {
  params: Promise<{
    country: string;
    locale: string;
    slug: string;
  }>;
}

/** `null` = genuine 404; `"unavailable"` = the AWJ API could not answer (never conflated with 404). */
async function loadPolicy(
  slug: string,
  locale: string,
): Promise<AwjPolicy | null | "unavailable"> {
  try {
    return await getPolicy(slug, { locale });
  } catch (error) {
    if (error instanceof PolicyUnavailableError) return "unavailable";
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PolicyPageProps): Promise<Metadata> {
  const { country, locale, slug } = await params;
  const policy = await loadPolicy(slug, locale);
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "policies",
  });

  // Metadata must never throw (it would surface the raw upstream error) and must not claim a 404 for an outage.
  if (policy === "unavailable") {
    return { title: t("policyUnavailable"), robots: { index: false } };
  }
  if (!policy) {
    return {
      title: t("policyNotFound"),
      description: t("noContent"),
      robots: { index: false },
    };
  }

  const storeName = await resolvePublishedStoreName();
  const description = storeName
    ? `${policy.title} — ${storeName}`
    : policy.title;
  const storeUrl = getStoreUrl();
  // Slugs are fixed and identical in every language, so the canonical is simply this page's own URL.
  const canonical = storeUrl
    ? buildCanonicalUrl(storeUrl, `/${country}/${locale}/policies/${slug}`)
    : undefined;

  return {
    title: policy.title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title: policy.title,
      description,
      ...(canonical ? { url: canonical } : {}),
    },
  };
}

export default async function PolicyPage({
  params,
}: PolicyPageProps): Promise<React.JSX.Element> {
  const { slug, locale } = await params;
  const policy = await loadPolicy(slug, locale);

  if (policy === "unavailable") {
    // Generic, message-free failure: the framework's error boundary renders it; no upstream detail leaks.
    throw new PolicyUnavailableError();
  }
  if (!policy) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* The text is shown in the language the backend actually served (it may be the fallback language). */}
      <article
        lang={policy.locale}
        dir={policy.locale === "ar" ? "rtl" : "ltr"}
      >
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          {policy.title}
        </h1>
        <div
          className="prose prose-gray"
          // Backend-sanitized HTML, re-verified against the same strict allowlist in `getPolicy`.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: allowlist-verified policy HTML
          dangerouslySetInnerHTML={{ __html: policy.html }}
        />
      </article>
    </div>
  );
}
