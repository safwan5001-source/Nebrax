import { describe, expect, it } from "vitest";
import {
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
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
});
