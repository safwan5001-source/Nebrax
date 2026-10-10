/**
 * CUST-HV V7a — renders the REAL published header (the production `Header`, theme wrapper attributes from the production
 * `publishedThemeAttrs` / `publishedThemeStyle`) for every structural design, for the browser proof in
 * `scripts/header-proof/measure.mjs`. Inert unless HEADER_PROOF_DIR is set (CI never runs it).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { normalizePresentationConfig } from "@/lib/presentation/config";
import { headerIsCompact } from "@/lib/presentation/header-design";
import {
  publishedThemeAttrs,
  publishedThemeStyle,
} from "@/lib/presentation/public";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async ({
    locale,
    namespace,
  }: {
    locale: string;
    namespace: string;
  }) => {
    const table =
      (
        (locale === "ar" ? ar : en) as unknown as Record<
          string,
          Record<string, string>
        >
      )[namespace] ?? {};
    return (key: string) => table[key] ?? key;
  },
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/spree", () => ({ isWholesaleEnabled: () => false }));
vi.mock("@/components/layout/StoreSearch", () => ({
  StoreSearch: ({ className }: { className?: string }) => (
    <div
      data-search=""
      className={className}
      style={{ height: "2.5rem", border: "1px solid #9ca3af", borderRadius: 8 }}
    />
  ),
}));
vi.mock("@/components/layout/CartButton", () => ({
  CartButton: ({ className }: { className?: string }) => (
    <button
      type="button"
      data-cart=""
      className={className}
      style={{ height: "2.5rem", minWidth: "2.5rem" }}
    >
      cart
    </button>
  ),
}));

import { Header } from "@/components/layout/Header";

const DIR = process.env.HEADER_PROOF_DIR ?? "";
// a flat 320x96 PNG — the logo sanitiser rejects SVG data URLs by design
const LOGO_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAABgCAYAAABsS6soAAABWUlEQVR4nO3UIQEAIBDAwM9ADArQPxnEQOzE+anNOvsCFM3vAIBfDBDIMkAgywCBLAMEsgwQyDJAIMsAgSwDBLIMEMgyQCDLAIEsAwSyDBDIMkAgywCBLAMEsgwQyDJAIMsAgSwDBLIMEMgyQCDLAIEsAwSyDBDIMkAgywCBLAMEsgwQyDJAIMsAgSwDBLIMEMgyQCDLAIEsAwSyDBDIMkAgywCBLAMEsgwQyDJAIMsAgSwDBLIMEMgyQCDLAIEsAwSyDBDIMkAgywCBLAMEsgwQyDJAIMsAgSwDBLIMEMgyQCDLAIEsAwSyDBDIMkAgywCBLAMEsgwQyDJAIMsAgSwDBLIMEMgyQCDLAIEsAwSyDBDIMkAgywCBLAMEsgwQyDJAIMsAgSwDBLIMEMgyQCDLAIEsAwSyDBDIMkAgywCBLAMEsgwQyDJAIMsAgSwDBLIMEMgyQCDrAay0eiSaz99pAAAAAElFTkSuQmCC";

const DESIGNS: Record<string, Record<string, unknown> | undefined> = {
  none: undefined,
  standardExplicit: { layout: "standard", sticky: "always" },
  centered: { layout: "centered" },
  twoRow: { layout: "two-row" },
  compactLayout: { layout: "compact" },
  mobileStart: { mobileLayout: "logo-start" },
  centeredStart: { layout: "centered", mobileLayout: "logo-start" },
  heightCompact: { height: "compact" },
  heightTall: { height: "tall" },
  logoXl: { logo: { size: "xl" } },
  logoSm: { logo: { size: "sm" } },
  stickyOff: { sticky: "off" },
  borderNone: { border: { width: "none" } },
  borderMedium: { border: { width: "medium" } },
  shadowSoft: { shadow: "soft" },
  shadowMedium: { shadow: "medium" },
  twoRowTall: { layout: "two-row", height: "tall", logo: { size: "lg" } },
  everything: {
    layout: "centered",
    mobileLayout: "logo-start",
    height: "tall",
    logo: { size: "xl" },
    sticky: "off",
    border: { width: "medium" },
    shadow: "medium",
  },
};

describe("header proof", () => {
  it.skipIf(!DIR)("renders every design × direction × logo kind", async () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    for (const [name, design] of Object.entries(DESIGNS)) {
      for (const dir of ["ltr", "rtl"] as const) {
        for (const logo of ["word", "image"] as const) {
          const presentation = normalizePresentationConfig({
            header: { ...(design ? { design } : {}) },
          });
          const compact = headerIsCompact(presentation.header);
          const header = await Header({
            basePath: "/sa/en",
            locale: dir === "rtl" ? "ar" : "en",
            storeName: "Daisy Shop Flowers",
            logoUrl: logo === "image" ? LOGO_PNG : null,
            compact,
            design: presentation.header.design,
            extraLinks: [
              { id: "a", label: "Offers", href: "/sa/en/offers" },
              { id: "b", label: "About us", href: "/sa/en/about" },
            ],
            mobileNavigation: (
              <button
                type="button"
                data-menu=""
                className="inline-flex"
                style={{ width: "2.5rem", height: "2.5rem" }}
              >
                menu
              </button>
            ),
            categoryNavigation: (
              <nav
                data-rail=""
                className="border-b border-store-border bg-store-surface-muted hidden md:block"
              >
                <div style={{ height: "2.375rem" }}>rail</div>
              </nav>
            ),
          });
          const attrs = publishedThemeAttrs(presentation) ?? {};
          const style = publishedThemeStyle(presentation) ?? {};
          const wrapper = renderToStaticMarkup(
            <div
              data-published-theme=""
              {...attrs}
              className="flex min-h-screen flex-1 flex-col"
              style={style}
            >
              {header}
              <main
                id="main-content"
                className="flex-1 scroll-mt-(--store-header-offset)"
              >
                <div style={{ height: "3000px" }}>page</div>
              </main>
            </div>,
          );
          const html = `<!doctype html><html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-surface-muted:#f3f4f6;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body>${wrapper}</body></html>`;
          writeFileSync(
            join(DIR, "pages", `${name}.${logo}.${dir}.html`),
            html,
          );
        }
      }
    }
    expect(true).toBe(true);
  });
});
