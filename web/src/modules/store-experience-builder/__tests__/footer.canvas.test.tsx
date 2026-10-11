/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG, normalizePresentationConfig, type StorefrontPresentationConfig } from "../presentation/config";
import { FOOTER_LAYOUTS } from "../presentation/footer-design";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

afterEach(cleanup);

const link = (id: string, label: string, target: unknown, extra: Record<string, unknown> = {}) => ({ id, label, target, ...extra });

function cfg(footer: Record<string, unknown>, extra: Record<string, unknown> = {}): StorefrontPresentationConfig {
  return normalizePresentationConfig({
    ...DEFAULT_PRESENTATION_CONFIG,
    footer: { ...DEFAULT_PRESENTATION_CONFIG.footer, tagline: "Fresh flowers", copyright: "© Daisy", ...footer },
    contact: { ...DEFAULT_PRESENTATION_CONFIG.contact, phone: "+966500000000", email: "hi@daisy.sa" },
    social: [{ id: "i", network: "instagram", url: "https://instagram.com/daisy", enabled: true }],
    whatsapp: { enabled: true, phone: "966500000000", message: "", placement: "footer" },
    apps: { ...DEFAULT_PRESENTATION_CONFIG.apps, iosUrl: "https://apps.apple.com/app/id1", showFooterLinks: true },
    ...extra,
  });
}

function mount(config: StorefrontPresentationConfig, viewport: "desktop" | "tablet" | "mobile" = "desktop") {
  const { container } = render(<StorefrontPreviewCanvas config={config} locale="en" viewport={viewport} />);
  return container.querySelector("footer") as HTMLElement;
}

const groups = [
  { id: "g1", title: "Shop", links: [link("a", "Offers", { kind: "home" }, { icon: "tag", badge: { text: "New", tone: "accent" } }), link("b", "About", { kind: "content", slug: "about" }), link("c", "Hidden", { kind: "home" }, { enabled: false })] },
  { id: "g2", title: "Help", links: [link("d", "Privacy", { kind: "content", slug: "privacy-policy" }), link("e", "Delivery", { kind: "home" })] },
  { id: "g3", title: "Empty only unserved", links: [link("f", "FAQ", { kind: "content", slug: "faq" })] },
  { id: "g4", title: "  ", links: [link("g", "Untitled group link", { kind: "home" })] },
];

describe("Canvas footer — backward compatibility (V7e-3)", () => {
  it("no layout / groups / design ⇒ the original preview footer", () => {
    const footer = mount(cfg({}));
    expect(footer.hasAttribute("data-footer-layout")).toBe(false);
    expect(footer.getAttribute("style")).toBeNull();
    expect(footer.textContent).toContain("Fresh flowers");
    for (const key of ["Shop", "Account", "Policies"]) expect(footer.textContent).toContain(key.slice(0, 4));
  });
});

describe("Canvas footer — groups (V7e-3)", () => {
  it("drop disabled, unserved-content and title-less entries exactly as the storefront does", () => {
    const footer = mount(cfg({ groups }));
    const text = footer.textContent ?? "";
    expect(text).toContain("Offers");
    expect(text).toContain("Privacy");
    expect(text).toContain("Delivery");
    for (const gone of ["About", "Hidden", "FAQ", "Empty only unserved", "Untitled group link"]) expect(text).not.toContain(gone);
    expect(footer.querySelector("[data-nav-badge='accent']")?.textContent).toBe("New");
  });

  it("a referenced menu wins over the group's own links", () => {
    const config = cfg(
      { groups: [{ id: "g", title: "Info", menu: "foot", links: [link("x", "Ignored", { kind: "home" })] }] },
      { navigation: { menus: [{ id: "foot", name: "", items: [link("m1", "From menu", { kind: "home" })] }] } },
    );
    const text = mount(config).textContent ?? "";
    expect(text).toContain("From menu");
    expect(text).not.toContain("Ignored");
  });
});

describe("Canvas footer — six layouts (V7e-3)", () => {
  for (const layout of FOOTER_LAYOUTS) {
    it(`${layout}: same data, nothing duplicated`, () => {
      const footer = mount(cfg({ layout, groups }));
      expect(footer.getAttribute("data-footer-layout")).toBe(layout);
      expect(footer.querySelectorAll("a[aria-label='Instagram']")).toHaveLength(1);
      expect(footer.querySelectorAll("a[data-preview-chrome='whatsapp']")).toHaveLength(1);
      expect(footer.textContent).toContain("© Daisy");
      expect(footer.textContent).toContain("hi@daisy.sa");
      // "Offers" appears once (minimal shows the first three links, still once)
      expect((footer.textContent ?? "").match(/Offers/g)).toHaveLength(1);
    });
  }

  it("compact and centered draw one labelled link row; minimal at most three links and no bottom bar", () => {
    for (const layout of ["compact", "centered"] as const) {
      const footer = mount(cfg({ layout, groups }));
      expect(footer.querySelectorAll("nav[aria-label]")).toHaveLength(1);
      expect(footer.querySelectorAll("h2")).toHaveLength(0);
      cleanup();
    }
    const minimal = mount(cfg({ layout: "minimal", groups: [{ id: "g", title: "G", links: Array.from({ length: 6 }, (_, i) => link(`l${i}`, `Link ${i}`, { kind: "home" })) }] }));
    expect(minimal.querySelectorAll("nav[aria-label] li")).toHaveLength(3);
    expect(Array.from(minimal.children).some((el) => el.className.includes("border-t"))).toBe(false);
  });

  it("editorial: the statement is a paragraph and the groups keep h2 headings", () => {
    const footer = mount(cfg({ layout: "editorial", groups }));
    const statement = Array.from(footer.querySelectorAll("p")).find((p) => p.textContent === "Fresh flowers");
    expect(statement?.className).toContain("text-2xl");
    expect(footer.querySelectorAll("h2").length).toBe(2);
  });

  it("brand-heavy: the band carries WhatsApp and the app badge, the trust grid does not", () => {
    const footer = mount(cfg({ layout: "brand-heavy", groups }));
    const band = footer.querySelector("section[data-footer-band]") as HTMLElement;
    expect(band.querySelector("a[data-preview-chrome='whatsapp']")).not.toBeNull();
    expect(band.querySelector("a[href^='https://apps.apple.com']")).not.toBeNull();
    const trust = footer.querySelector("[data-footer-trust]") as HTMLElement;
    expect(trust.querySelector("a[data-preview-chrome='whatsapp']")).toBeNull();
  });

  it("columns on a phone: groups past the fourth are collapsed disclosures that open", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, title: `Group ${i}`, links: [link(`l${i}`, `Item ${i}`, { kind: "home" })] }));
    const user = userEvent.setup();
    const footer = mount(cfg({ layout: "columns", groups: six }), "mobile");
    const buttons = footer.querySelectorAll<HTMLButtonElement>("button[aria-expanded]");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
    await user.click(buttons[0] as HTMLButtonElement);
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");
    cleanup();
    expect(mount(cfg({ layout: "columns", groups: six }), "desktop").querySelectorAll("button[aria-expanded]")).toHaveLength(0);
  });

  it("brand-heavy on a phone: every group is a disclosure", () => {
    const footer = mount(cfg({ layout: "brand-heavy", groups }), "mobile");
    expect(footer.querySelectorAll("button[aria-expanded]")).toHaveLength(2);
  });
});

describe("Canvas footer — design (V7e-3)", () => {
  it("colour variables land on the footer exactly as the storefront resolves them; spacing and alignment map to literal classes", () => {
    const footer = mount(
      cfg({ layout: "columns", groups, design: { surface: { background: { hex: "#f8fafc" } }, spacing: { top: "lg", bottom: "sm" }, align: "end" } }),
    );
    expect(footer.style.getPropertyValue("--store-footer")).toBe("#f8fafc");
    expect(footer.style.getPropertyValue("--store-footer-foreground")).toBe("#000000");
    expect(footer.innerHTML).toContain("pt-14");
    expect(footer.innerHTML).toContain("pb-6");
    expect(footer.innerHTML).toContain("items-end text-end");
  });

  it("explicit colours override only what they name", () => {
    const footer = mount(cfg({ design: { link: { hex: "#e2e8f0" } } }));
    expect(footer.style.getPropertyValue("--store-footer-link")).toBe("#e2e8f0");
    expect(footer.style.getPropertyValue("--store-footer")).toBe("");
  });

});
