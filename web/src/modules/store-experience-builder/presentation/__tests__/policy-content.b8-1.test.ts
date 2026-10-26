import { describe, expect, it } from "vitest";
import { normalizePresentationConfig, policyContentIssues } from "../config";

describe("B8-1 policy content (compat)", () => {
  const page = (slug: string, extra: Record<string, unknown> = {}) => ({
    id: `p-${slug}`,
    slug,
    title: "legacy",
    enabled: true,
    ...extra,
  });

  it("legacy pages and defaults gain no content key", () => {
    const def = normalizePresentationConfig(null);
    for (const p of def.pages) expect("content" in p).toBe(false);
    const out = normalizePresentationConfig({ pages: [page("returns-policy")] });
    expect(out.pages).toEqual([page("returns-policy")]);
  });

  it("keeps localized content on policy slugs only, idempotently", () => {
    const content = {
      ar: { title: "ع", body: "نص" },
      en: { title: "T", body: "B" },
      fr: { title: "x", body: "y" },
    };
    const out = normalizePresentationConfig({
      pages: [page("privacy-policy", { content }), page("about", { content })],
    });
    expect(out.pages[0].content).toEqual({
      ar: { title: "ع", body: "نص" },
      en: { title: "T", body: "B" },
    });
    expect(out.pages[0].title).toBe("legacy");
    expect("content" in out.pages[1]).toBe(false);
    expect(normalizePresentationConfig(out).pages).toEqual(out.pages);
  });

  it("caps lengths and drops empty or malformed content", () => {
    const out = normalizePresentationConfig({
      pages: [
        page("terms-of-service", {
          content: {
            ar: { title: "x".repeat(200), body: "y".repeat(30000) },
            en: { title: " ", body: "" },
          },
        }),
        page("shipping-policy", { content: "bad" }),
      ],
    });
    expect(Object.keys(out.pages[0].content ?? {})).toEqual(["ar"]);
    expect(out.pages[0].content?.ar?.title).toHaveLength(80);
    expect(out.pages[0].content?.ar?.body).toHaveLength(20000);
    expect("content" in out.pages[1]).toBe(false);
  });

  it("reports over-limit text, accepts the exact boundary", () => {
    const at = (body: number, title: number) => ({
      pages: [
        page("privacy-policy", {
          content: { ar: { title: "ع".repeat(title), body: "ب".repeat(body) } },
        }),
        page("about", { content: { ar: { title: "x", body: "z".repeat(30000) } } }),
      ],
    });
    expect(policyContentIssues(at(20000, 80))).toEqual([]);
    expect(policyContentIssues(at(20001, 81))).toEqual([
      { path: "pages.0.content.ar.title", code: "policy_title_too_long" },
      { path: "pages.0.content.ar.body", code: "policy_body_too_long" },
    ]);
    expect(policyContentIssues(null)).toEqual([]);
  });
});
