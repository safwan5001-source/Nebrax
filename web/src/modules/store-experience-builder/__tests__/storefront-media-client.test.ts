import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import {
  fetchStorefrontMediaAsset,
  mapStorefrontMediaAsset,
  mediaRefTransform,
  resolveAltCoverage,
  usageNeedsDerivatives,
} from "@/modules/commerce-workspace/storefront-media";
import { describePublishIssues } from "../announcement-status";
import { customizerMessage } from "../messages";
import { CUSTOMIZER_MESSAGES } from "../messages";
import type { MediaRef } from "../presentation/media-ref";

const ID = "0b9d6a3e-1f5c-4a8e-9a47-2c1d3e4f5a6b";
const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

afterEach(() => vi.restoreAllMocks());

describe("storefront media client helpers (CUST-HV V4b)", () => {
  it("maps an asset defensively and never invents fields", () => {
    const a = mapStorefrontMediaAsset({
      id: ID,
      name: "a.jpg",
      width: 10,
      height: 5,
      variants_state: "weird",
      storage_key: "tenant/x/secret",
      thumbnail_url: "",
    });
    expect(a.variantsState).toBe("pending");
    expect(a.thumbnailUrl).toBeNull();
    expect(JSON.stringify(a)).not.toContain("secret");
    expect(mapStorefrontMediaAsset({ variants_state: "ready" }).variantsState).toBe("ready");
  });

  it("derives the transform from the reference's framing fields only", () => {
    const ref: MediaRef = {
      mediaId: ID,
      alt: { en: "x" },
      decorative: true,
      rotate: 90,
      fit: "contain",
      focal: { x: 1, y: 2 },
      crop: { x: 0, y: 0, w: 1, h: 1, aspect: "1:1" },
    };
    expect(mediaRefTransform(ref)).toEqual({
      crop: ref.crop,
      rotate: 90,
      focal: ref.focal,
      fit: "contain",
    });
    expect(usageNeedsDerivatives({ mediaId: ID, alt: { en: "x" } })).toBe(false);
    expect(usageNeedsDerivatives({ mediaId: ID, rotate: 180 })).toBe(true);
  });

  it("resolves alt per locale: decorative › override › library(that locale) › missing", () => {
    const lib = { altAr: "ع", altEn: null };
    expect(resolveAltCoverage({ decorative: true }, lib, "en")).toEqual({ kind: "decorative" });
    expect(resolveAltCoverage({ alt: { en: " E " } }, lib, "en")).toEqual({ kind: "override", text: "E" });
    expect(resolveAltCoverage({}, lib, "ar")).toEqual({ kind: "library", text: "ع" });
    // Arabic never stands in for English
    expect(resolveAltCoverage({ alt: { ar: "x" } }, lib, "en")).toEqual({ kind: "missing" });
    expect(resolveAltCoverage({}, null, "ar")).toEqual({ kind: "missing" });
    expect(resolveAltCoverage({ alt: { en: "   " } }, { altAr: null, altEn: null }, "en")).toEqual({ kind: "missing" });
  });

  it("treats a 404 on single-asset read as 'deleted elsewhere' (null), other failures propagate", async () => {
    const api = await import("@/lib/api");
    vi.spyOn(api, "api").mockRejectedValueOnce(new ApiError(404, "nf", {}));
    expect(await fetchStorefrontMediaAsset(ID)).toBeNull();
    vi.spyOn(api, "api").mockRejectedValueOnce(new ApiError(500, "boom", {}));
    await expect(fetchStorefrontMediaAsset(ID)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("media publish issues (CUST-HV V4b)", () => {
  it("names the slot and the locale, never a raw code", () => {
    const text = describePublishIssues(
      {
        "branding.logoMedia.alt.en": "alt_required_en",
        "branding.faviconMedia.mediaId": "media_missing",
        "branding.compactLogoMedia": "derivative_failed",
      },
      t,
    )!;
    expect(text).toContain(t("mediaPublishBlocked"));
    expect(text).toContain(`${t("logo")}: ${t("mediaIssue_alt_required_en")}`);
    expect(text).toContain(`${t("favicon")}: ${t("mediaIssue_media_missing")}`);
    expect(text).toContain(`${t("compactLogo")}: ${t("mediaIssue_derivative_failed")}`);
    expect(text).not.toMatch(/alt_required|media_missing|derivative_failed/);
  });

  it("keeps announcement and media sentences separate when both fail", () => {
    const text = describePublishIssues(
      { "announcements.items[0].text": "announcement_text_required", "branding.logoMedia.mediaId": "media_not_ready" },
      t,
    )!;
    expect(text).toContain(t("annPublishBlocked"));
    expect(text).toContain(t("mediaPublishBlocked"));
  });

  it("ignores unrelated paths/codes", () => {
    expect(describePublishIssues({ "header.style": "x" }, t)).toBeNull();
  });
});

describe("media message parity", () => {
  it("every media key exists in both locales", () => {
    const en = Object.keys(CUSTOMIZER_MESSAGES.en).filter((k) => k.startsWith("media"));
    const ar = Object.keys(CUSTOMIZER_MESSAGES.ar).filter((k) => k.startsWith("media"));
    expect(en.sort()).toEqual(ar.sort());
    expect(en.length).toBeGreaterThan(80);
  });
});
