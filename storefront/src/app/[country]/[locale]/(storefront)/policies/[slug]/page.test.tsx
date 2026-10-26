import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AwjPolicy,
  getPolicy,
  PolicyUnavailableError,
} from "@/lib/data/policies";
import PolicyPage, { generateMetadata } from "./page";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
}));

vi.mock("@/lib/data/policies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/policies")>()),
  getPolicy: vi.fn(),
}));

const policy: AwjPolicy = {
  slug: "privacy-policy",
  locale: "ar",
  fallback: false,
  title: "سياسة الخصوصية",
  html: "<h2>بيانات</h2><p>نحمي <strong>بياناتك</strong></p>",
};

const params = (
  over: Partial<{ country: string; locale: string; slug: string }> = {},
) =>
  Promise.resolve({
    country: "sa",
    locale: "ar",
    slug: "privacy-policy",
    ...over,
  });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://store.example/");
  vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "Example Store");
  vi.mocked(getPolicy).mockResolvedValue(policy);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("policy metadata (X4)", () => {
  it("uses the AWJ policy and the page's own URL as canonical", async () => {
    const metadata = await generateMetadata({ params: params() });
    const canonical = "https://store.example/sa/ar/policies/privacy-policy";

    expect(metadata).toMatchObject({
      title: "سياسة الخصوصية",
      description: "سياسة الخصوصية — Example Store",
      alternates: { canonical },
      openGraph: { title: "سياسة الخصوصية", url: canonical },
    });
    expect(getPolicy).toHaveBeenCalledWith("privacy-policy", { locale: "ar" });
  });

  it("omits canonical rather than guessing when the store URL is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const metadata = await generateMetadata({ params: params() });
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.title).toBe("سياسة الخصوصية");
  });

  it("a missing policy gets the not-found title and is not indexed", async () => {
    vi.mocked(getPolicy).mockResolvedValue(null);
    await expect(generateMetadata({ params: params() })).resolves.toMatchObject(
      {
        title: "policyNotFound",
        robots: { index: false },
      },
    );
  });

  it("an API outage never throws from metadata and is not reported as a 404", async () => {
    vi.mocked(getPolicy).mockRejectedValue(new PolicyUnavailableError());
    const metadata = await generateMetadata({ params: params() });
    expect(metadata).toMatchObject({
      title: "policyUnavailable",
      robots: { index: false },
    });
    expect(metadata.title).not.toBe("policyNotFound");
  });

  it("does not swallow unexpected programming errors", async () => {
    vi.mocked(getPolicy).mockRejectedValue(new TypeError("bug"));
    await expect(generateMetadata({ params: params() })).rejects.toThrow("bug");
  });
});

describe("policy page (X4)", () => {
  const render = async (over = {}) =>
    renderToStaticMarkup(await PolicyPage({ params: params(over) }));

  it("renders the published policy with the existing page styling", async () => {
    const markup = await render();
    expect(markup).toContain(
      '<h1 class="text-3xl font-bold text-gray-900 mb-8">سياسة الخصوصية</h1>',
    );
    expect(markup).toContain('class="prose prose-gray"');
    expect(markup).toContain(
      "<h2>بيانات</h2><p>نحمي <strong>بياناتك</strong></p>",
    );
    expect(markup).toContain("max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12");
  });

  it("sets direction and language from the language actually served (RTL / LTR / fallback)", async () => {
    expect(await render()).toMatch(/<article lang="ar" dir="rtl">/);

    vi.mocked(getPolicy).mockResolvedValue({
      ...policy,
      locale: "en",
      title: "Privacy",
    });
    expect(await render({ locale: "en" })).toMatch(
      /<article lang="en" dir="ltr">/,
    );

    // Arabic page, English text served as the fallback ⇒ the article is LTR even inside an RTL page.
    expect(await render({ locale: "ar" })).toMatch(
      /<article lang="en" dir="ltr">/,
    );
  });

  it("a missing, disabled, unpublished or empty policy is a real 404", async () => {
    vi.mocked(getPolicy).mockResolvedValue(null);
    await expect(PolicyPage({ params: params() })).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("an API outage fails with a generic error — distinct from 404, no upstream detail", async () => {
    vi.mocked(getPolicy).mockRejectedValue(
      new PolicyUnavailableError({ cause: new Error("db-internal is down") }),
    );
    const error = (await PolicyPage({ params: params() }).catch(
      (e: unknown) => e,
    )) as Error;

    expect(error).toBeInstanceOf(PolicyUnavailableError);
    expect(error.message).toBe("Policy page is temporarily unavailable.");
    expect((error as { digest?: string }).digest).toBeUndefined();
    expect(error.message).not.toMatch(/db-internal|spree/i);
  });
});
