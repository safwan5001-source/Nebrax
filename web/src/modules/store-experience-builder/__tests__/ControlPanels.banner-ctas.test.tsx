/**
 * @vitest-environment jsdom
 *
 * CUST-HV V6c-2 (V0 §8.2) — the Banner's call-to-action editor: two slots (label + deferred link) over the same
 * `ctas` model Hero uses, with the legacy `ctaLabel/ctaHref` as `ctas[0]`. `ctas[0]` is mirrored back into the
 * legacy pair so an older reader still shows the first button; an empty slot is not stored; a half-typed https
 * link is held locally and committed on blur, never swallowed by the per-keystroke normaliser.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { CUSTOMIZER_MESSAGES } from "../messages";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type PresentationHomeSection,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import type { BannerContent } from "../presentation/section-content";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

afterEach(cleanup);

const banner = (content: Partial<BannerContent> = {}): PresentationHomeSection => ({
  id: "banner-1",
  type: "banner",
  visible: true,
  content: { title: "Summer sale", subtitle: "", ctaLabel: "", ctaHref: "", imageUrl: null, ...content },
});

const withSections = (sections: PresentationHomeSection[]): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
});

// A stateful host: the builder feeds every change back as the next `config`, so successive edits accumulate.
function Host({
  initial,
  onChange,
}: {
  initial: StorefrontPresentationConfig;
  onChange: (config: StorefrontPresentationConfig) => void;
}) {
  const [config, setConfig] = useState(initial);
  return (
    <ControlPanels
      panel="homepage"
      config={config}
      locale="en"
      liveStoreName={null}
      onChange={(next) => {
        setConfig(next);
        onChange(next);
      }}
      selectedSection="banner-1"
    />
  );
}

function panel(section: PresentationHomeSection) {
  const onChange = vi.fn();
  render(<Host initial={withSections([section])} onChange={onChange} />);
  return onChange;
}

const lastBanner = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.at(-1)?.[0].homepage.sections[0].content as BannerContent;

const slot = (index: number) => document.querySelector(`[data-banner-cta-slot="${index}"]`) as HTMLElement;
const labelInput = (index: number) => slot(index).querySelector("input") as HTMLInputElement;
const hrefInput = (index: number) => slot(index).querySelectorAll("input")[1] as HTMLInputElement;

describe("Banner CTA editor (CUST-HV V6c-2)", () => {
  it("shows two slots; a legacy banner's pair fills the first", () => {
    panel(banner({ ctaLabel: "Shop", ctaHref: "/products" }));
    expect(document.querySelectorAll("[data-banner-cta-slot]")).toHaveLength(2);
    expect(labelInput(0).value).toBe("Shop");
    expect(hrefInput(0).value).toBe("/products");
    expect(labelInput(1).value).toBe("");
  });

  it("authored `ctas` fill the slots and win over a stale legacy pair", () => {
    panel(
      banner({
        ctaLabel: "Old",
        ctaHref: "/old",
        ctas: [
          { label: "New", href: "/new" },
          { label: "More", href: "/more" },
        ],
      }),
    );
    expect(labelInput(0).value).toBe("New");
    expect(labelInput(1).value).toBe("More");
  });

  it("typing the first label writes ctas and mirrors ctas[0] into the legacy pair", () => {
    const onChange = panel(banner());
    fireEvent.change(labelInput(0), { target: { value: "Shop" } });
    const content = lastBanner(onChange);
    expect(content.ctas).toEqual([{ label: "Shop", href: "" }]);
    expect(content.ctaLabel).toBe("Shop");
    expect(content.ctaHref).toBe("");
    expect(content.title).toBe("Summer sale"); // the rest untouched
  });

  it("a second button is stored as ctas[1] and leaves the mirror on the first", () => {
    const onChange = panel(banner({ ctas: [{ label: "Shop", href: "/products" }], ctaLabel: "Shop", ctaHref: "/products" }));
    fireEvent.change(labelInput(1), { target: { value: "Learn more" } });
    const content = lastBanner(onChange);
    expect(content.ctas).toEqual([
      { label: "Shop", href: "/products" },
      { label: "Learn more", href: "" },
    ]);
    expect(content.ctaLabel).toBe("Shop");
    expect(content.ctaHref).toBe("/products");
  });

  it("clearing the first slot promotes the second (an empty slot is not stored) and re-mirrors", () => {
    const onChange = panel(
      banner({
        ctaLabel: "A",
        ctaHref: "/a",
        ctas: [
          { label: "A", href: "/a" },
          { label: "B", href: "/b" },
        ],
      }),
    );
    fireEvent.change(labelInput(0), { target: { value: "" } });
    // the link is still "/a", so slot 0 is not empty yet — clear it too
    fireEvent.change(hrefInput(0), { target: { value: "" } });
    fireEvent.blur(hrefInput(0));
    const content = lastBanner(onChange);
    expect(content.ctas).toEqual([{ label: "B", href: "/b" }]);
    expect(content.ctaLabel).toBe("B");
    expect(content.ctaHref).toBe("/b");
  });

  it("clearing everything removes `ctas` and empties the legacy pair", () => {
    const onChange = panel(banner({ ctaLabel: "Shop", ctaHref: "/p", ctas: [{ label: "Shop", href: "/p" }] }));
    fireEvent.change(labelInput(0), { target: { value: "" } });
    fireEvent.change(hrefInput(0), { target: { value: "" } });
    fireEvent.blur(hrefInput(0));
    const content = lastBanner(onChange);
    expect("ctas" in content).toBe(false);
    expect(content.ctaLabel).toBe("");
    expect(content.ctaHref).toBe("");
  });

  it("the link is held locally while typed and committed on blur (a half-typed https:// is not swallowed)", () => {
    const onChange = panel(banner({ ctas: [{ label: "Shop", href: "" }], ctaLabel: "Shop" }));
    onChange.mockClear();
    fireEvent.change(hrefInput(0), { target: { value: "https://exa" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(hrefInput(0).value).toBe("https://exa");
    fireEvent.change(hrefInput(0), { target: { value: "https://example.com/sale" } });
    fireEvent.blur(hrefInput(0));
    expect(lastBanner(onChange).ctas).toEqual([{ label: "Shop", href: "https://example.com/sale" }]);
    expect(lastBanner(onChange).ctaHref).toBe("https://example.com/sale");
  });

  it("the Hero editor still has its two slots after sharing the component", () => {
    const onChange = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withSections([{ id: "hero", type: "hero", visible: true, content: { headline: "H" } }])}
        locale="en"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="hero"
      />,
    );
    expect(document.querySelectorAll("[data-hero-cta-slot]")).toHaveLength(2);
  });
});

describe("Canvas banner CTAs (CUST-HV V6c-2)", () => {
  const canvas = (content: Partial<BannerContent>) =>
    render(
      <StorefrontPreviewCanvas
        config={withSections([banner(content)])}
        locale="en"
        viewport="desktop"
        liveStoreName="Shop"
        onSelectSection={() => {}}
      />,
    ).container;
  const buttons = (c: HTMLElement) => [...c.querySelectorAll("[data-banner-cta]")].map((b) => b.textContent);

  it("renders the legacy pair as one button, exactly as before", () => {
    expect(buttons(canvas({ ctaLabel: "Shop", ctaHref: "/products" }))).toEqual(["Shop"]);
  });

  it("renders two complete buttons in order; skips an incomplete one", () => {
    expect(
      buttons(
        canvas({
          ctas: [
            { label: "A", href: "/a" },
            { label: "B", href: "https://example.com/b" },
          ],
        }),
      ),
    ).toEqual(["A", "B"]);
    cleanup();
    expect(buttons(canvas({ ctas: [{ label: "No link", href: "" }, { label: "OK", href: "/ok" }] }))).toEqual(["OK"]);
  });

  it("a banner with only a labelled button is not 'empty'", () => {
    const c = canvas({ title: "", ctas: [{ label: "Shop", href: "/p" }] });
    expect(buttons(c)).toEqual(["Shop"]);
  });
});

describe("CTA style select (CUST-HV V6c-5)", () => {
  const styleSelect = (index: number) =>
    slot(index).querySelector("[data-cta-style-select]") as HTMLSelectElement;

  it("offers Automatic / Filled / Soft / Outlined / Text link, and is disabled while the slot is empty", () => {
    panel(banner({ ctas: [{ label: "Shop", href: "/products" }], ctaLabel: "Shop", ctaHref: "/products" }));
    expect([...styleSelect(0).options].map((o) => o.value)).toEqual(["", "solid", "soft", "outline", "link"]);
    expect(styleSelect(0).disabled).toBe(false);
    expect(styleSelect(1).disabled).toBe(true); // nothing to style until the button exists
  });

  it("writes the style onto that button only, keeps the legacy mirror on label/href, and Automatic removes the key", () => {
    const onChange = panel(
      banner({
        ctas: [
          { label: "Shop", href: "/products" },
          { label: "More", href: "/about" },
        ],
        ctaLabel: "Shop",
        ctaHref: "/products",
      }),
    );
    fireEvent.change(styleSelect(1), { target: { value: "link" } });
    expect(lastBanner(onChange).ctas).toEqual([
      { label: "Shop", href: "/products" },
      { label: "More", href: "/about", style: "link" },
    ]);
    fireEvent.change(styleSelect(0), { target: { value: "outline" } });
    const content = lastBanner(onChange);
    expect(content.ctas?.[0]).toEqual({ label: "Shop", href: "/products", style: "outline" });
    expect(content.ctaLabel).toBe("Shop");
    fireEvent.change(styleSelect(1), { target: { value: "" } });
    expect(lastBanner(onChange).ctas?.[1]).toEqual({ label: "More", href: "/about" });
    expect("style" in (lastBanner(onChange).ctas?.[1] ?? {})).toBe(false);
  });

  it("the Hero editor has the same control per slot", () => {
    const onChange = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withSections([
          { id: "hero", type: "hero", visible: true, content: { headline: "H", ctas: [{ label: "Go", href: "/go" }] } },
        ])}
        locale="en"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="hero"
      />,
    );
    const select = document.querySelector('[data-hero-cta-slot="0"] [data-cta-style-select]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "outline" } });
    const sections = onChange.mock.calls.at(-1)?.[0].homepage.sections;
    expect(sections[0].content.ctas).toEqual([{ label: "Go", href: "/go", style: "outline" }]);
  });

  it("has AR and EN copy for every new key", () => {
    for (const key of ["ctaStyle", "ctaStyleDefault", "ctaStyleSolid", "ctaStyleOutline", "ctaStyleLink"] as const) {
      expect(CUSTOMIZER_MESSAGES.ar[key]).toBeTruthy();
      expect(CUSTOMIZER_MESSAGES.en[key]).toBeTruthy();
    }
  });
});

describe("CTA colour select and live contrast advisory (CUST-HV V6c-6)", () => {
  const colourSelect = (index: number) => slot(index).querySelector("[data-cta-colour-select]") as HTMLSelectElement;
  const styleSelect = (index: number) => slot(index).querySelector("[data-cta-style-select]") as HTMLSelectElement;
  const issue = (index: number) => slot(index).querySelector("[data-cta-colour-issue]");
  const two = {
    ctas: [
      { label: "Shop", href: "/products" },
      { label: "More", href: "/about" },
    ],
    ctaLabel: "Shop",
    ctaHref: "/products",
  };

  it("offers Automatic / Brand / Accent / Text, disabled while the slot is empty; Automatic removes the key", () => {
    const onChange = panel(banner(two));
    expect([...colourSelect(0).options].map((o) => o.value)).toEqual(["", "brand", "accent", "text"]);
    fireEvent.change(colourSelect(1), { target: { value: "brand" } });
    expect(lastBanner(onChange).ctas?.[1]).toEqual({ label: "More", href: "/about", colour: "brand" });
    fireEvent.change(colourSelect(1), { target: { value: "" } });
    expect("colour" in (lastBanner(onChange).ctas?.[1] ?? {})).toBe(false);
  });

  it("Soft without a colour picks the brand colour (never a silent no-op)", () => {
    const onChange = panel(banner(two));
    fireEvent.change(styleSelect(0), { target: { value: "soft" } });
    expect(lastBanner(onChange).ctas?.[0]).toEqual({ label: "Shop", href: "/products", style: "soft", colour: "brand" });
  });

  it("an outline or link whose colour the gate would reject says so on that button; filled and soft never do", () => {
    // a banner on its own white surface: the brand colour passes, the light accent tint does not
    panel(banner({ ctas: [{ label: "A", href: "/a", style: "link", colour: "accent" }, { label: "B", href: "/b", style: "solid", colour: "text" }] }));
    expect(issue(0)?.getAttribute("data-cta-colour-issue")).toBe("contrast_insufficient");
    expect(issue(1)).toBeNull();
  });

  it("a passing colour shows no advisory", () => {
    panel(banner({ ctas: [{ label: "A", href: "/a", style: "outline", colour: "brand" }] }));
    expect(issue(0)).toBeNull();
  });

  it("has AR and EN copy for every new key", () => {
    for (const key of [
      "ctaStyleSoft",
      "ctaColour",
      "ctaColourDefault",
      "ctaColourBrand",
      "ctaColourAccent",
      "ctaColourText",
      "ctaColourInsufficient",
      "ctaColourUnprovable",
    ] as const) {
      expect(CUSTOMIZER_MESSAGES.ar[key]).toBeTruthy();
      expect(CUSTOMIZER_MESSAGES.en[key]).toBeTruthy();
    }
  });
});
