import { describe, expect, it, vi } from "vitest";
import { DocumentShell } from "./DocumentShell";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist" }),
  Tajawal: () => ({ variable: "--font-tajawal" }),
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
    expect(body.props.className).toContain("--font-tajawal");
  });
});
