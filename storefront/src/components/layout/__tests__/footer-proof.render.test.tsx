/**
 * CUST-HV V7e-2 — renders the REAL published footer (the production `Footer` + `resolveFooterDesign` + `resolveFooterGroups`)
 * for every layout × design variant × direction, for the browser proof in `scripts/footer-proof/measure.mjs`. The one client
 * component (`FooterGroupDisclosure`) is replaced by a placeholder with the same markup that `scripts/footer-proof/mount.tsx`
 * swaps for the real component in the browser. Inert unless FOOTER_PROOF_DIR is set (CI never runs it).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FOOTER_LAYOUTS,
  normalizeFooterDesign,
  resolveFooterDesign,
} from "@/lib/presentation/footer-design";
import type { ResolvedFooterGroup } from "@/lib/presentation/navigation-resolve";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

vi.mock("next/server", () => ({ connection: vi.fn() }));
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
vi.mock("@/components/layout/FooterGroupDisclosure", () => ({
  FooterGroupDisclosure: ({
    id,
    title,
    collapsible,
    headingClassName,
    listClassName,
    children,
  }: {
    id: string;
    title: string;
    collapsible: boolean;
    headingClassName: string;
    listClassName: string;
    children: ReactNode;
  }) => (
    <nav
      aria-labelledby={id}
      data-fgd=""
      data-collapsible={String(collapsible)}
    >
      <h2 id={id} className={headingClassName}>
        {title}
      </h2>
      <ul className={listClassName}>{children}</ul>
    </nav>
  ),
}));

import { Footer } from "@/components/layout/Footer";

const DIR = process.env.FOOTER_PROOF_DIR ?? "";
const CTX = { primaryColor: "#12372a", accentColor: null };

const LABELS = {
  en: [
    "Offers",
    "Our story",
    "Delivery",
    "Returns policy",
    "Gift cards",
    "Careers",
    "Press",
    "Wholesale accounts",
  ],
  ar: [
    "العروض",
    "قصتنا",
    "التوصيل",
    "سياسة الاسترجاع",
    "بطاقات الهدايا",
    "الوظائف",
    "الصحافة",
    "حسابات الجملة",
  ],
};
const TITLES = {
  en: ["Shop", "Company", "Support", "Legal", "Partners", "Community"],
  ar: ["التسوق", "الشركة", "الدعم", "القانونية", "الشركاء", "المجتمع"],
};

function groups(dir: "ltr" | "rtl", n: number): ResolvedFooterGroup[] {
  const l = dir === "rtl" ? "ar" : "en";
  return Array.from({ length: n }, (_, i) => ({
    id: `g${i + 1}`,
    title: TITLES[l][i] as string,
    span: 1 as const,
    items: [0, 1, 2].map((j) => ({
      id: `g${i}l${j}`,
      label: LABELS[l][(i + j) % LABELS[l].length] as string,
      href: `/sa/en/p/${i}-${j}`,
      newTab: false,
      ...(i === 0 && j === 0
        ? {
            icon: "tag" as const,
            badge: {
              text: dir === "rtl" ? "جديد" : "New",
              tone: "accent" as const,
            },
          }
        : {}),
    })),
  }));
}

const VARIANTS: Record<string, { design?: unknown; groups: number }> = {
  def: { groups: 3 },
  light: { groups: 3, design: { surface: { background: { hex: "#f8fafc" } } } },
  brand: {
    groups: 3,
    design: {
      surface: { background: { role: "brand" } },
      spacing: { top: "lg", bottom: "sm" },
    },
  },
  explicit: {
    groups: 3,
    design: {
      surface: { background: { hex: "#0f172a" } },
      heading: { hex: "#fde68a" },
      link: { hex: "#e2e8f0" },
      text: { hex: "#cbd5e1" },
      divider: { color: { hex: "#334155" } },
    },
  },
  g6: { groups: 6 },
  endalign: { groups: 3, design: { align: "end", logo: { size: "lg" } } },
};

const PAGES: Array<[string, string]> = [
  ...FOOTER_LAYOUTS.flatMap(
    (l) =>
      [
        [l, "def"],
        [l, "light"],
      ] as Array<[string, string]>,
  ),
  ["columns", "g6"],
  ["brand-heavy", "g6"],
  ["centered", "explicit"],
  ["editorial", "brand"],
  ["compact", "brand"],
  ["minimal", "explicit"],
  ["columns", "endalign"],
  ["centered", "endalign"],
];

describe("footer proof", () => {
  it.skipIf(!DIR)("renders every layout × variant × direction", async () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    for (const [layout, variantName] of PAGES) {
      const variant = VARIANTS[variantName] as (typeof VARIANTS)[string];
      for (const dir of ["ltr", "rtl"] as const) {
        const rtl = dir === "rtl";
        const design = resolveFooterDesign(
          normalizeFooterDesign(variant.design),
          CTX,
        );
        const el = await Footer({
          basePath: "/sa/en",
          locale: (rtl ? "ar" : "en") as Locale,
          categoryLinks: null,
          storeName: rtl ? "متجر الأزهار" : "Daisy Shop Flowers",
          tagline: rtl
            ? "ورود طازجة تصل إلى بابك كل يوم"
            : "Fresh flowers delivered to your door every day",
          copyright: rtl ? "© متجر الأزهار" : "© Daisy Shop Flowers",
          businessIdentity: {
            legal_name: rtl ? "شركة الأزهار" : "Daisy Flowers Co",
            cr_number: "1010123456",
            vat_number: "300123456700003",
          },
          contact: {
            phone: "+966500000000",
            email: "hello@daisy.sa",
            address: rtl ? "الرياض، طريق الملك فهد" : "King Fahd Road, Riyadh",
            hours: rtl ? "٩ص – ٩م" : "9am – 9pm",
          },
          socialLinks: [
            {
              id: "i",
              network: "instagram",
              href: "https://instagram.com/daisy",
            },
            { id: "x", network: "x", href: "https://x.com/daisy" },
          ],
          whatsappHref: "https://wa.me/966500000000",
          appLinks: [
            {
              id: "a",
              store: "apple",
              label: "App Store",
              href: "https://apps.apple.com/app/id1",
            },
          ],
          layout: layout as (typeof FOOTER_LAYOUTS)[number],
          groups: groups(dir, variant.groups),
          design,
        });
        const html = `<!doctype html><html lang="${rtl ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-accent:#ffd166;--store-accent-foreground:#111827;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body><div style="min-height:300px;padding:16px">page content</div>${renderToStaticMarkup(el)}</body></html>`;
        writeFileSync(
          join(DIR, "pages", `${layout}.${variantName}.${dir}.html`),
          html,
        );
      }
    }
    expect(true).toBe(true);
  });
});
