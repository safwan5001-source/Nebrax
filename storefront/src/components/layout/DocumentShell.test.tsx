import { describe, expect, it, vi } from "vitest";
import { DocumentShell } from "./DocumentShell";

/**
 * `DocumentShell` now calls `Geist(...)` twice — once for `--font-geist`
 * (Cairo fallback), once for `--font-geist-tajawal` (Tajawal fallback) — so
 * the mock must capture every call, keyed by the `variable` each call
 * actually requests, and return that same `variable` back (not a hardcoded
 * string), or a second call would silently overwrite the first's captured
 * options and both instances would collapse onto one class name.
 */
const fontOptions = vi.hoisted(() => ({
  geistCalls: [] as Record<string, unknown>[],
  cairo: undefined as Record<string, unknown> | undefined,
  tajawal: undefined as Record<string, unknown> | undefined,
}));

vi.mock("next/font/google", () => ({
  Geist: (options: Record<string, unknown>) => {
    fontOptions.geistCalls.push(options);
    return { variable: options.variable };
  },
  Cairo: (options: Record<string, unknown>) => {
    fontOptions.cairo = options;
    return { variable: options.variable };
  },
  Tajawal: (options: Record<string, unknown>) => {
    fontOptions.tajawal = options;
    return { variable: options.variable };
  },
}));

vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: () => null,
}));

vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => null,
}));

vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: () => null,
}));

describe("DocumentShell", () => {
  it("renders the route locale and tolerates extension root mutations", () => {
    const document = DocumentShell({
      children: <main>Storefront</main>,
      locale: "de",
    });

    expect(document.type).toBe("html");
    expect(document.props.lang).toBe("de");
    expect(document.props.dir).toBe("ltr");
    expect(document.props.suppressHydrationWarning).toBe(true);
  });

  it("sets the document direction for RTL language tags", () => {
    const document = DocumentShell({
      children: <main>Storefront</main>,
      locale: "ar",
    });

    expect(document.props.dir).toBe("rtl");
  });

  it("renders Arabic — AWJ Store's primary language — with lang=ar and dir=rtl", () => {
    const document = DocumentShell({
      children: <main>Storefront</main>,
      locale: "ar",
    });

    expect(document.props.lang).toBe("ar");
    expect(document.props.dir).toBe("rtl");
  });

  it("renders English with lang=en and dir=ltr", () => {
    const document = DocumentShell({
      children: <main>Storefront</main>,
      locale: "en",
    });

    expect(document.props.lang).toBe("en");
    expect(document.props.dir).toBe("ltr");
  });

  it("declares the Arabic face on every document, not only on Arabic routes", () => {
    const document = DocumentShell({
      children: <main>Storefront</main>,
      locale: "en",
    });
    const body = document.props.children.find(
      (child: { type?: string } | false | null) =>
        child && typeof child === "object" && child.type === "body",
    );

    expect(body.props.className).toContain("--font-geist");
    expect(body.props.className).toContain("--font-cairo");
  });

  it("names Cairo as Geist's fallback so Arabic can reach it", () => {
    // Without this, --font-geist expands to `"Geist", "Geist Fallback"`, and
    // that generated face is local(Arial) with no unicode-range — it answers
    // for Arabic, so Cairo never receives the glyph.
    const geistDefault = fontOptions.geistCalls.find(
      (call) => call.variable === "--font-geist",
    );
    expect(geistDefault?.fallback).toContain("Cairo");
    expect(fontOptions.cairo?.subsets).toContain("arabic");
  });

  it("declares the curated Tajawal alternative on every document too (CUST-H3-2)", () => {
    const document = DocumentShell({
      children: <main>Storefront</main>,
      locale: "en",
    });
    const body = document.props.children.find(
      (child: { type?: string } | false | null) =>
        child && typeof child === "object" && child.type === "body",
    );

    expect(body.props.className).toContain("--font-tajawal");
    expect(fontOptions.tajawal?.subsets).toContain("arabic");
    expect(fontOptions.tajawal?.weight).not.toContain("600");
  });

  it("CUST-H3-2-FIX-1: declares a second Geist instance whose own fallback names Tajawal, not Cairo", () => {
    const document = DocumentShell({
      children: <main>Storefront</main>,
      locale: "en",
    });
    const body = document.props.children.find(
      (child: { type?: string } | false | null) =>
        child && typeof child === "object" && child.type === "body",
    );

    // Two distinct Geist calls, not one call overwritten by the other.
    expect(fontOptions.geistCalls).toHaveLength(2);

    const cairoFallbackGeist = fontOptions.geistCalls.find(
      (call) => call.variable === "--font-geist",
    );
    const tajawalFallbackGeist = fontOptions.geistCalls.find(
      (call) => call.variable === "--font-geist-tajawal",
    );

    expect(cairoFallbackGeist?.fallback).toEqual(["Cairo"]);
    expect(tajawalFallbackGeist?.fallback).toEqual(["Tajawal"]);
    // The Tajawal-fallback instance must never also name Cairo — that is
    // exactly the bug this fix closes (Cairo answering for Arabic before
    // Tajawal is ever reached).
    expect(tajawalFallbackGeist?.fallback).not.toContain("Cairo");

    expect(body.props.className).toContain("--font-geist-tajawal");
  });
});
