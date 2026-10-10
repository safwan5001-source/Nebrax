/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

afterEach(cleanup);

function withDesign(
  design: NonNullable<StorefrontPresentationConfig["header"]["design"]>,
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    header: { ...DEFAULT_PRESENTATION_CONFIG.header, design },
  };
}

function canvas(config: StorefrontPresentationConfig, viewport: "desktop" | "mobile" = "desktop") {
  const { container } = render(
    <StorefrontPreviewCanvas config={config} locale="en" viewport={viewport} />,
  );
  const root = container.querySelector("[data-preview-canvas]") as HTMLElement;
  const header = root.querySelector("header") as HTMLElement;
  return { root, header, container };
}

describe("Canvas header design (V7a)", () => {
  it("absent design ⇒ no data-hd, sticky header, flex identity row", () => {
    const { root, header } = canvas(DEFAULT_PRESENTATION_CONFIG);
    expect(root.hasAttribute("data-hd")).toBe(false);
    expect(header.className).toContain("sticky");
    expect(header.querySelector(".flex.items-center.gap-6")).not.toBeNull();
  });

  it("tokens land on the Canvas root exactly as on the storefront wrapper", () => {
    const { root } = canvas(
      withDesign({ height: "tall", border: { width: "none" }, shadow: "soft", sticky: "off" }),
    );
    expect(root.getAttribute("data-hd")).toBe("hh-t hs-o hb-n hx-s");
  });

  it("sticky off drops the sticky positioning", () => {
    const { header } = canvas(withDesign({ sticky: "off" }));
    expect(header.className).not.toContain("sticky");
    expect(header.className).toContain("relative");
  });

  it("centered places search, brand and actions on one three-column row", () => {
    const { header } = canvas(withDesign({ layout: "centered" }));
    const row = header.querySelector(".grid-cols-\\[minmax\\(0\\,1fr\\)_auto_minmax\\(0\\,1fr\\)\\]");
    expect(row).not.toBeNull();
    expect(row?.querySelector(".col-start-2")).not.toBeNull();
    expect(row?.querySelector(".col-start-1")).not.toBeNull();
    expect(row?.querySelector(".col-start-3")).not.toBeNull();
  });

  it("two-row sends the search to a second row", () => {
    const { header } = canvas(withDesign({ layout: "two-row" }));
    expect(header.querySelector(".order-last.col-span-2")).not.toBeNull();
  });

  it("design.layout compact hides the utility strip even when the legacy style is standard", () => {
    const withStrip = canvas(DEFAULT_PRESENTATION_CONFIG).header;
    expect(withStrip.querySelector(".bg-store-surface-muted")).not.toBeNull();
    cleanup();
    const compact = canvas(withDesign({ layout: "compact" })).header;
    expect(compact.querySelector(".h-7")).toBeNull();
  });

  it("design.layout standard overrides a legacy compact style", () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      header: { ...DEFAULT_PRESENTATION_CONFIG.header, style: "compact" as const, design: { layout: "standard" as const } },
    };
    const { header } = canvas(config);
    expect(header.querySelector(".h-7")).not.toBeNull();
  });

  it("mobile logo-start left-aligns the brand and mirrors the grid", () => {
    const { header } = canvas(withDesign({ mobileLayout: "logo-start" }), "mobile");
    expect(header.querySelector(".grid-cols-\\[auto_minmax\\(0\\,1fr\\)_auto\\]")).not.toBeNull();
    expect(header.querySelector("button.justify-self-start")).not.toBeNull();
  });

  it("the desktop-only layouts never apply inside the phone frame", () => {
    const { header } = canvas(withDesign({ layout: "two-row" }), "mobile");
    expect(header.querySelector(".order-last.col-span-2")).toBeNull();
    expect(header.querySelector(".grid-cols-\\[1fr_minmax\\(0\\,1fr\\)_1fr\\]")).not.toBeNull();
  });

  it("height sets a minimum on the identity row and logo size scales the wordmark", () => {
    const { header } = canvas(withDesign({ height: "tall", logo: { size: "xl" } }));
    const row = header.querySelector("[style*='min-height']") as HTMLElement;
    expect(row.style.minHeight).toBe("5rem");
    expect(header.querySelector(".text-4xl")).not.toBeNull();
  });
});

describe("Header design panel (V7a)", () => {
  function setup(config: StorefrontPresentationConfig, onChange = vi.fn()) {
    render(
      <ControlPanels panel="header" config={config} locale="en" liveStoreName={null} onChange={onChange} />,
    );
    return onChange;
  }

  it("every select starts on Default and nothing is written until the merchant chooses", async () => {
    const onChange = setup(DEFAULT_PRESENTATION_CONFIG);
    const selects = document.querySelectorAll<HTMLSelectElement>("[data-header-design]");
    expect(selects.length).toBe(7);
    for (const select of selects) expect(select.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector("[data-header-design-reset]")).toBeNull();
  });

  it("choosing writes a normalised header.design beside the untouched legacy fields", async () => {
    const user = userEvent.setup();
    const onChange = setup(DEFAULT_PRESENTATION_CONFIG);
    await user.selectOptions(document.querySelector("[data-header-design='layout']") as HTMLSelectElement, "centered");
    const next = onChange.mock.calls.at(-1)?.[0] as StorefrontPresentationConfig;
    expect(next.header.design).toEqual({ layout: "centered" });
    expect(next.header.style).toBe("standard");
    expect(next.header.links).toEqual(DEFAULT_PRESENTATION_CONFIG.header.links);
  });

  it("clearing the last field removes the key — the header is as before", async () => {
    const user = userEvent.setup();
    const onChange = setup(withDesign({ shadow: "soft" }));
    await user.selectOptions(document.querySelector("[data-header-design='shadow']") as HTMLSelectElement, "");
    const next = onChange.mock.calls.at(-1)?.[0] as StorefrontPresentationConfig;
    expect("design" in next.header).toBe(false);
  });

  it("reset removes the whole design; nested fields round-trip", async () => {
    const user = userEvent.setup();
    const onChange = setup(withDesign({ logo: { size: "lg" }, border: { width: "medium" } }));
    expect((document.querySelector("[data-header-design='logo-size']") as HTMLSelectElement).value).toBe("lg");
    expect((document.querySelector("[data-header-design='border']") as HTMLSelectElement).value).toBe("medium");
    await user.click(document.querySelector("[data-header-design-reset]") as HTMLElement);
    const next = onChange.mock.calls.at(-1)?.[0] as StorefrontPresentationConfig;
    expect("design" in next.header).toBe(false);
  });

  it("warns that the layout choice overrides the legacy style", () => {
    setup(withDesign({ layout: "compact" }));
    expect(document.querySelector("[data-header-style-overridden]")).not.toBeNull();
    cleanup();
    setup(withDesign({ shadow: "soft" }));
    expect(document.querySelector("[data-header-style-overridden]")).toBeNull();
    expect(screen.queryByText(/takes precedence/)).toBeNull();
  });
});

describe("header chrome CSS is one rule set in both stylesheets", () => {
  it("border + shadow rules match modulo the preview scope", () => {
    const sf = readFileSync(resolve(__dirname, "../../../../../storefront/src/app/globals.css"), "utf8");
    const pv = readFileSync(resolve(__dirname, "../store-preview.css"), "utf8");
    const block = (css: string) =>
      css.slice(css.indexOf("/* V7a-chrome:start */"), css.indexOf("/* V7a-chrome:end */"));
    const norm = (css: string) => block(css).replace(/\.awj-store-preview(?=\[)/g, "").replace(/\s+/g, " ").trim();
    expect(block(sf).length).toBeGreaterThan(100);
    expect(norm(pv)).toBe(norm(sf));
  });
});
