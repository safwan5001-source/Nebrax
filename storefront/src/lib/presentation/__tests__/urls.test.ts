import { describe, expect, it } from "vitest";
import {
  appStoreBadgeUrl,
  buildWhatsAppUrl,
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  normalizeWhatsAppPhone,
  playStoreBadgeUrl,
  sanitizeExternalUrl,
  sanitizeLogoUrl,
} from "../urls";

describe("presentation URL handling", () => {
  it("allows https and rejects javascript and http", () => {
    expect(sanitizeExternalUrl("https://example.com/x")).toBe(
      "https://example.com/x",
    );
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeExternalUrl("http://example.com")).toBeNull();
    expect(sanitizeExternalUrl("data:text/html,hi")).toBeNull();
  });

  it("allows raster data URLs for logos and rejects SVG", () => {
    expect(sanitizeLogoUrl("data:image/png;base64,iVBORw0KGgo=")).toMatch(
      /^data:image\/png/,
    );
    expect(sanitizeLogoUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
  });

  it("builds a wa.me URL only from a usable number and never fakes a send", () => {
    expect(normalizeWhatsAppPhone("966 55 123 4567")).toBe("+966551234567");
    expect(buildWhatsAppUrl("966551234567", "مرحبا")).toBe(
      "https://wa.me/966551234567?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7",
    );
    expect(buildWhatsAppUrl("12", "hi")).toBeNull();
  });

  it("accepts only apps.apple.com and the existing Play hosts", () => {
    expect(isSafeAppStoreUrl("https://apps.apple.com/app/id1")).toBe(true);
    expect(isSafeAppStoreUrl("https://www.apple.com/iphone")).toBe(false);
    expect(isSafeAppStoreUrl("https://itunes.apple.com/app/id1")).toBe(false);
    expect(
      isSafePlayStoreUrl(
        "https://play.google.com/store/apps/details?id=com.example",
      ),
    ).toBe(true);
    expect(isSafePlayStoreUrl("https://play.app.goo.gl/example")).toBe(true);
    expect(isSafePlayStoreUrl("https://example.com/app")).toBe(false);
  });

  it("points at the live first-party badge and localizes only Arabic", () => {
    expect(appStoreBadgeUrl("ar")).toBe(
      "https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/ar-sa?size=250x83",
    );
    expect(appStoreBadgeUrl("en")).toContain("/en-us?");
    expect(appStoreBadgeUrl("de")).toContain("/en-us?");
    expect(playStoreBadgeUrl("ar")).toBe(
      "https://play.google.com/intl/en_us/badges/static/images/badges/ar_badge_web_generic.png",
    );
    expect(playStoreBadgeUrl("fr")).toContain("/en_badge_web_generic.png");
  });
});
