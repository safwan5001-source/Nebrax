/**
 * CUST-H4-4 — Banner `imageAlt`: additive, bounded, plain-text, and
 * backward-compatible. Twin of
 * web/src/modules/store-experience-builder/__tests__/section-content.h4-4.test.ts
 * — both normalizers must agree byte-for-byte.
 */
import { describe, expect, it } from "vitest";
import {
  emptyBannerContent,
  MAX_BANNER_IMAGE_ALT_LENGTH,
  normalizeOptionalSectionContent,
} from "../section-content";

describe("Banner imageAlt normalization (CUST-H4-4)", () => {
  it("defaults to an empty string when absent (backward compatible with pre-H4-4 documents)", () => {
    const content = normalizeOptionalSectionContent("banner", {
      title: "عرض الصيف",
    }) as { imageAlt: string } | undefined;
    expect(content?.imageAlt).toBe("");
  });

  it("trims and keeps a plain-text alt value", () => {
    const content = normalizeOptionalSectionContent("banner", {
      title: "عرض الصيف",
      imageAlt: "  صورة لافتة الصيف  ",
    }) as { imageAlt: string } | undefined;
    expect(content?.imageAlt).toBe("صورة لافتة الصيف");
  });

  it(`bounds imageAlt to ${MAX_BANNER_IMAGE_ALT_LENGTH} characters`, () => {
    const long = "a".repeat(400);
    const content = normalizeOptionalSectionContent("banner", {
      title: "x",
      imageAlt: long,
    }) as { imageAlt: string } | undefined;
    expect(content?.imageAlt).toHaveLength(MAX_BANNER_IMAGE_ALT_LENGTH);
  });

  it("drops a non-string imageAlt to the empty default rather than throwing", () => {
    const content = normalizeOptionalSectionContent("banner", {
      title: "x",
      imageAlt: { malicious: "<img onerror=alert(1)>" },
    }) as { imageAlt: string } | undefined;
    expect(content?.imageAlt).toBe("");
  });

  it("never renders imageAlt as markup — it is stored and read as plain text only", () => {
    const content = normalizeOptionalSectionContent("banner", {
      title: "x",
      imageAlt: "<script>alert(1)</script>",
    }) as { imageAlt: string } | undefined;
    // No HTML stripping is performed (none of the other text fields strip
    // HTML either) because nothing in the render path ever interprets this
    // string as markup — React's `alt` attribute is always plain text.
    expect(content?.imageAlt).toBe("<script>alert(1)</script>");
  });

  it("does not count stray imageAlt-only content as a non-empty banner", () => {
    // Every other field blank + only imageAlt set is still considered empty
    // — matches the existing isEmptyBanner contract exactly.
    const content = normalizeOptionalSectionContent("banner", {
      imageAlt: "some text with nothing else",
    });
    expect(content).toBeUndefined();
  });

  it("is idempotent — normalizing twice yields the same imageAlt", () => {
    const once = normalizeOptionalSectionContent("banner", {
      title: "x",
      imageAlt: "  وصف الصورة  ",
    }) as { imageAlt: string };
    const twice = normalizeOptionalSectionContent(
      "banner",
      JSON.parse(JSON.stringify(once)),
    ) as { imageAlt: string };
    expect(twice.imageAlt).toBe(once.imageAlt);
  });

  it("emptyBannerContent() includes an empty imageAlt by default", () => {
    expect(emptyBannerContent().imageAlt).toBe("");
  });

  it("existing banner fields keep their own bounds and sanitization unchanged by this addition", () => {
    const content = normalizeOptionalSectionContent("banner", {
      title: "x",
      ctaHref: "javascript:alert(1)",
      imageUrl: "javascript:alert(1)",
      imageAlt: "a safe description",
    }) as {
      ctaHref: string;
      imageUrl: string | null;
      imageAlt: string;
    };
    expect(content.ctaHref).toBe("");
    expect(content.imageUrl).toBeNull();
    expect(content.imageAlt).toBe("a safe description");
  });

  describe("Unicode code-point-aware truncation (review fix)", () => {
    const EMOJI = "😀"; // U+1F600 — an astral codepoint: 2 UTF-16 units, 1 character.

    it(`keeps exactly ${MAX_BANNER_IMAGE_ALT_LENGTH} emoji when exactly at the limit (naive UTF-16 slice would keep only ~half)`, () => {
      const input = EMOJI.repeat(MAX_BANNER_IMAGE_ALT_LENGTH);
      const content = normalizeOptionalSectionContent("banner", {
        title: "x",
        imageAlt: input,
      }) as { imageAlt: string };
      expect(Array.from(content.imageAlt)).toHaveLength(
        MAX_BANNER_IMAGE_ALT_LENGTH,
      );
      expect(content.imageAlt).toBe(input);
    });

    it(`truncates ${MAX_BANNER_IMAGE_ALT_LENGTH + 1} emoji down to exactly ${MAX_BANNER_IMAGE_ALT_LENGTH}`, () => {
      const input = EMOJI.repeat(MAX_BANNER_IMAGE_ALT_LENGTH + 1);
      const content = normalizeOptionalSectionContent("banner", {
        title: "x",
        imageAlt: input,
      }) as { imageAlt: string };
      expect(Array.from(content.imageAlt)).toHaveLength(
        MAX_BANNER_IMAGE_ALT_LENGTH,
      );
      expect(content.imageAlt).toBe(EMOJI.repeat(MAX_BANNER_IMAGE_ALT_LENGTH));
    });

    it("never cuts a mixed BMP + astral string into an unpaired surrogate at the boundary", () => {
      const input = `${"a".repeat(MAX_BANNER_IMAGE_ALT_LENGTH - 1)}${EMOJI}more text after`;
      const naiveBroken = input.slice(0, MAX_BANNER_IMAGE_ALT_LENGTH);
      expect(naiveBroken.endsWith(EMOJI)).toBe(false);

      const content = normalizeOptionalSectionContent("banner", {
        title: "x",
        imageAlt: input,
      }) as { imageAlt: string };
      expect(content.imageAlt).toBe(
        `${"a".repeat(MAX_BANNER_IMAGE_ALT_LENGTH - 1)}${EMOJI}`,
      );
      expect(Array.from(content.imageAlt)).toHaveLength(
        MAX_BANNER_IMAGE_ALT_LENGTH,
      );
      expect(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
          content.imageAlt,
        ),
      ).toBe(false);
    });

    it("stays semantically aligned with the PHP server-authoritative normalizer's mb_substr (code-point counting, not UTF-16 units)", () => {
      // Twin assertion of tests/Feature/StorefrontPresentationNormalizerTest.php's
      // `banner_image_alt_truncates_by_unicode_code_point_not_utf16_unit` and
      // the web twin's identical test — all three must agree that 150 emoji
      // stay 150 emoji.
      const input = EMOJI.repeat(MAX_BANNER_IMAGE_ALT_LENGTH);
      const content = normalizeOptionalSectionContent("banner", {
        title: "x",
        imageAlt: input,
      }) as { imageAlt: string };
      expect(Array.from(content.imageAlt)).toHaveLength(
        MAX_BANNER_IMAGE_ALT_LENGTH,
      );
    });
  });
});
