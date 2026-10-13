import { describe, expect, it } from "vitest";
import { CUSTOMIZER_MESSAGES } from "../messages";

/**
 * AWJ-HORIZON-MEDIA-STORAGE O-2 — النص المعروض يجب أن يطابق حدّ الخادم الفعلي لمكتبة وسائط المتجر
 * (`config/storefront_media.php` → `max_bytes` = 5 * 1024 * 1024). كان يقول 20MB بينما يرفض الخادم ما فوق 5MB.
 */
describe("media upload hint matches the real server limit", () => {
  it("states 5 MB in both locales and never the old 20 MB", () => {
    expect(CUSTOMIZER_MESSAGES.en.mediaUploadHint).toContain("5 MB");
    expect(CUSTOMIZER_MESSAGES.en.mediaUploadHint).not.toContain("20");
    expect(CUSTOMIZER_MESSAGES.ar.mediaUploadHint).toContain("٥ ميغابايت");
    expect(CUSTOMIZER_MESSAGES.ar.mediaUploadHint).not.toContain("٢٠");
  });
});
