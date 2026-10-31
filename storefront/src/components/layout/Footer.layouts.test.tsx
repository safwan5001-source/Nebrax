import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOOTER_LAYOUTS,
  type FooterLayout,
  resolveFooterDesign,
} from "@/lib/presentation/footer-design";
import type { ResolvedFooterGroup } from "@/lib/presentation/navigation-resolve";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

import { Footer } from "./Footer";

afterEach(cleanup);

const groups = (n: number): ResolvedFooterGroup[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${i + 1}`,
    title: `Group ${i + 1}`,
    span: 1 as const,
    items: [
      {
        id: `a${i}`,
        label: `Link ${i + 1}a`,
        href: `/sa/en/a${i}`,
        newTab: false,
      },
      {
        id: `b${i}`,
        label: `Link ${i + 1}b`,
        href: `https://example.com/${i}`,
        newTab: true,
      },
    ],
  }));

const props = {
  basePath: "/sa/en",
  locale: "en" as Locale,
  categoryLinks: null,
  storeName: "Daisy Shop",
  tagline: "Fresh flowers every day",
  copyright: "© Daisy",
  businessIdentity: {
    legal_name: "Daisy Co",
    cr_number: "1010",
    vat_number: "3000",
  },
  showSbc: false,
  contact: {
    phone: "+966500000000",
    email: "hi@daisy.sa",
    address: "Riyadh",
    hours: "9–5",
  },
  socialLinks: [
    { id: "i", network: "instagram", href: "https://instagram.com/daisy" },
  ],
  whatsappHref: "https://wa.me/966500000000",
  appLinks: [
    {
      id: "a",
      store: "apple" as const,
      label: "App Store",
      href: "https://apps.apple.com/app/id1",
    },
  ],
};

async function mount(over: Record<string, unknown> = {}) {
  const el = await Footer({ ...props, ...over } as never);
  const view = render(el);
  const footer = view.container.querySelector("footer") as HTMLElement;
  return { footer, view };
}

function narrow(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as never;
}

describe("Footer layouts — shared contract (V7e-2)", () => {
  for (const layout of FOOTER_LAYOUTS) {
    it(`${layout}: same data, nothing dropped or duplicated`, async () => {
      const { footer } = await mount({ layout, groups: groups(3) });
      expect(footer.getAttribute("data-footer-layout")).toBe(layout);
      const text = footer.textContent ?? "";
      // identity & verification are visible in every layout
      for (const must of ["Daisy Co", "1010", "3000", "© Daisy"])
        expect(text).toContain(must);
      // contact + exactly one social mark + one WhatsApp link + one app badge, wherever the layout draws them
      expect(
        footer.querySelectorAll('a[href="https://instagram.com/daisy"]'),
      ).toHaveLength(1);
      expect(
        footer.querySelectorAll('a[href="https://wa.me/966500000000"]'),
      ).toHaveLength(1);
      expect(
        footer.querySelectorAll('a[href^="https://apps.apple.com"]'),
      ).toHaveLength(1);
      expect(text).toContain("hi@daisy.sa");
      // the merchant's links appear exactly once each (minimal draws at most three)
      const linkCount = footer.querySelectorAll('a[href="/sa/en/a0"]').length;
      expect(linkCount).toBe(1);
      // one <footer> landmark, every external link safe
      expect(document.querySelectorAll("footer")).toHaveLength(1);
      for (const a of footer.querySelectorAll('a[target="_blank"]'))
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    });
  }

  it("the six layouts are exactly the contract's", () => {
    expect([...FOOTER_LAYOUTS]).toEqual([
      "compact",
      "columns",
      "centered",
      "editorial",
      "minimal",
      "brand-heavy",
    ] satisfies FooterLayout[]);
  });
});

describe("Footer layouts — per-layout structure (V7e-2)", () => {
  it("compact and centered draw one labelled link row, no group headings", async () => {
    for (const layout of ["compact", "centered"] as const) {
      const { footer } = await mount({ layout, groups: groups(3) });
      expect(
        within(footer).getAllByRole("navigation", { name: "quickLinks" }),
      ).toHaveLength(1);
      expect(footer.querySelectorAll("h2[id^='footer-g-']")).toHaveLength(0);
      // links are touch-sized
      for (const a of footer.querySelectorAll('nav[aria-label="quickLinks"] a'))
        expect(a.className).toContain("min-h-11");
      cleanup();
    }
  });

  it("centered aligns its stack to the centre by default", async () => {
    const { footer } = await mount({ layout: "centered", groups: groups(2) });
    expect(footer.innerHTML).toContain("items-center text-center");
  });

  it("minimal: the copyright and at most three links share one line; the bottom bar is gone", async () => {
    const { footer } = await mount({ layout: "minimal", groups: groups(3) });
    expect(
      footer.querySelectorAll('nav[aria-label="quickLinks"] a'),
    ).toHaveLength(3);
    expect(
      footer.querySelectorAll(
        ".border-t.border-store-footer-border > .py-5, .border-t > div.py-5",
      ),
    ).toHaveLength(0);
    expect((footer.textContent ?? "").match(/© Daisy/g)).toHaveLength(1);
  });

  it("editorial: the statement is a paragraph, groups keep h2 headings", async () => {
    const { footer } = await mount({ layout: "editorial", groups: groups(3) });
    const statement = within(footer).getByText("Fresh flowers every day");
    expect(statement.tagName).toBe("P");
    expect(footer.querySelectorAll("h2[id^='footer-g-']")).toHaveLength(3);
  });

  it("brand-heavy: the CTA band is a labelled section carrying WhatsApp and the app badges, not the trust grid", async () => {
    const { footer } = await mount({
      layout: "brand-heavy",
      groups: groups(2),
    });
    const band = footer.querySelector(
      "section[data-footer-band]",
    ) as HTMLElement;
    expect(band.getAttribute("aria-label")).toBe("Daisy Shop");
    expect(
      band.querySelector('a[href="https://wa.me/966500000000"]'),
    ).not.toBeNull();
    expect(
      band.querySelector('a[href^="https://apps.apple.com"]'),
    ).not.toBeNull();
    const trust = footer.querySelector("[data-footer-trust]") as HTMLElement;
    expect(trust.querySelector('a[href^="https://apps.apple.com"]')).toBeNull();
    expect(band.querySelector('a[href$="/products"]')).not.toBeNull();
  });

  it("columns: brand block first, then the groups", async () => {
    const { footer } = await mount({ layout: "columns", groups: groups(3) });
    const grid = footer.querySelector(".grid") as HTMLElement;
    expect(grid.firstElementChild?.textContent).toContain("Daisy Shop");
    expect(
      footer.querySelectorAll("nav[aria-labelledby^='footer-g-']"),
    ).toHaveLength(3);
  });

  it("a layout without merchant groups falls back to the three fixed groups", async () => {
    const { footer } = await mount({ layout: "columns", groups: null });
    for (const id of ["footer-shop", "footer-account", "footer-policies"])
      expect(footer.querySelector(`#${id}`)).not.toBeNull();
  });

  it("groups alone (no layout) replace the fixed columns inside the original structure", async () => {
    const { footer } = await mount({ groups: groups(2) });
    expect(footer.hasAttribute("data-footer-layout")).toBe(false);
    expect(footer.querySelector("#footer-shop")).toBeNull();
    expect(
      footer.querySelectorAll("nav[aria-labelledby^='footer-g-']"),
    ).toHaveLength(2);
  });
});

describe("Footer disclosures (V7e-2)", () => {
  it("no JavaScript / wide: every group is a plain heading over its links", async () => {
    narrow(false);
    const { footer } = await mount({ layout: "columns", groups: groups(6) });
    await act(async () => {});
    expect(footer.querySelectorAll("button[aria-expanded]")).toHaveLength(0);
    expect(footer.querySelectorAll("a[href='/sa/en/a5']")).toHaveLength(1);
  });

  it("narrow columns: groups past the fourth become collapsed disclosures, the first four stay open", async () => {
    narrow(true);
    const user = userEvent.setup();
    const { footer } = await mount({ layout: "columns", groups: groups(6) });
    await act(async () => {});
    const buttons = footer.querySelectorAll<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
    const panelId = buttons[0]?.getAttribute("aria-controls") as string;
    expect(document.getElementById(panelId)?.hasAttribute("hidden")).toBe(true);
    await user.click(buttons[0] as HTMLButtonElement);
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(panelId)?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(footer.querySelectorAll("#footer-g-g1 button")).toHaveLength(0);
  });

  it("narrow brand-heavy: every group is a disclosure", async () => {
    narrow(true);
    const { footer } = await mount({
      layout: "brand-heavy",
      groups: groups(3),
    });
    await act(async () => {});
    expect(footer.querySelectorAll("button[aria-expanded]")).toHaveLength(3);
  });
});

describe("Footer design (V7e-2)", () => {
  const ctx = { primaryColor: "#12372a", accentColor: null };

  it("colour variables land on the footer element; spacing and alignment map to literal classes", async () => {
    const design = resolveFooterDesign(
      {
        surface: { background: { hex: "#f8fafc" } },
        spacing: { top: "lg", bottom: "sm" },
        align: "end",
      },
      ctx,
    );
    const { footer } = await mount({
      layout: "columns",
      groups: groups(2),
      design,
    });
    expect(footer.style.getPropertyValue("--store-footer")).toBe("#f8fafc");
    expect(footer.style.getPropertyValue("--store-footer-foreground")).toBe(
      "#000000",
    );
    const container = footer.firstElementChild as HTMLElement;
    expect(container.className).toContain("pt-14");
    expect(container.className).toContain("pb-6");
    expect(footer.innerHTML).toContain("items-end text-end");
  });

  it("no colour keys ⇒ no style attribute at all", async () => {
    const { footer } = await mount({
      layout: "columns",
      groups: groups(2),
      design: resolveFooterDesign({ align: "center" }, ctx),
    });
    expect(footer.getAttribute("style")).toBeNull();
  });

  it("group links carry their icon and badge", async () => {
    const withIcon: ResolvedFooterGroup[] = [
      {
        id: "g",
        title: "T",
        span: 1,
        items: [
          {
            id: "x",
            label: "Sale",
            href: "/sa/en/sale",
            newTab: false,
            icon: "tag",
            badge: { text: "New", tone: "accent" },
          },
        ],
      },
    ];
    const { footer } = await mount({ layout: "columns", groups: withIcon });
    expect(footer.querySelector("[data-nav-badge='accent']")?.textContent).toBe(
      "New",
    );
    expect(screen.getByRole("link", { name: /Sale/ })).toBeTruthy();
  });
});
