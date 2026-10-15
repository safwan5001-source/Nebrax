/**
 * @vitest-environment jsdom
 *
 * AWJ-VD-H1 / VD-4c — the discovery display controls wired into the real ControlPanels: what the panel emits is
 * what the builder normalizer (the twin of PHP's) would store, legacy documents are untouched, and the VD-4a
 * editor round-trip (settings survive a rename) still holds with the new controls in place.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { normalizeOptionalSectionContent } from "../presentation/section-content";

const merchandising = vi.hoisted(() => ({
  loadCollections: vi.fn(),
  loadFacets: vi.fn(),
}));

vi.mock("@/modules/commerce-workspace/merchandising/client", () => merchandising);

const FACETS = [
  {
    id: "f1",
    key: "occasion",
    systemKey: "occasion",
    name: "المناسبة",
    nameEn: "Occasion",
    sortOrder: 0,
    isActive: true,
    values: [
      { id: "v1", slug: "birthday", name: "عيد ميلاد", nameEn: "Birthday", sortOrder: 0, isActive: true, productCount: 2 },
      { id: "v2", slug: "wedding", name: "زفاف", nameEn: "Wedding", sortOrder: 1, isActive: true, productCount: 7 },
    ],
  },
];

function withDiscovery(content?: unknown): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [{ id: "s1", type: "discovery", visible: true, content } as never],
    },
  };
}

function renderPanel(config: StorefrontPresentationConfig, locale: "ar" | "en" = "en") {
  const onChange = vi.fn();
  render(
    <ControlPanels
      panel="homepage"
      config={config}
      locale={locale}
      liveStoreName={null}
      onChange={onChange}
      selectedSection="s1"
    />,
  );
  return onChange;
}

function lastContent(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> | undefined {
  const calls = onChange.mock.calls;
  const next = calls[calls.length - 1][0] as StorefrontPresentationConfig;
  return next.homepage.sections[0].content as Record<string, unknown> | undefined;
}

const display = () => within(document.querySelector("[data-discovery-display]") as HTMLElement);

const LEGACY = { title: "تسوّق حسب", axis: "facet", dimension: "occasion", display: "tiles" };

describe("Store Builder — discovery display controls (VD-4c)", () => {
  beforeEach(() => {
    merchandising.loadCollections.mockResolvedValue([]);
    merchandising.loadFacets.mockResolvedValue(FACETS);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("a legacy document is emitted byte-for-byte unchanged by edits that do not touch display settings", async () => {
    const onChange = renderPanel(withDiscovery(LEGACY));
    await screen.findByLabelText("Dimension");
    fireEvent.change(screen.getByLabelText("Display"), { target: { value: "chips" } });
    const content = lastContent(onChange);
    expect(content).toEqual({ ...LEGACY, display: "chips" });
    expect(Object.keys(content ?? {})).toEqual(["title", "axis", "dimension", "display"]);
  });

  it("choosing a template emits only `template` after the four base keys", async () => {
    const onChange = renderPanel(withDiscovery(LEGACY));
    await screen.findByLabelText("Dimension");
    fireEvent.click(screen.getByRole("button", { name: /Gift circles/ }));
    const content = lastContent(onChange);
    expect(content).toEqual({ ...LEGACY, template: "gift-circles" });
    expect(Object.keys(content ?? {})).toEqual(["title", "axis", "dimension", "display", "template"]);
  });

  it("what the panel emits equals what the builder normalizer would store (nothing the PHP twin would change)", async () => {
    const onChange = renderPanel(withDiscovery(LEGACY));
    await screen.findByLabelText("Dimension");
    fireEvent.click(screen.getByRole("button", { name: /Swipe rail/ }));
    fireEvent.click(within(document.querySelector('[data-dd-control="layout"]') as HTMLElement).getByRole("button", { name: "Text list" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Columns: Desktop" }), { target: { value: "7" } });
    fireEvent.click(display().getByRole("button", { name: /^Content/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Maximum values" }), { target: { value: "20" } });
    const content = lastContent(onChange);
    expect(content).toEqual({
      ...LEGACY,
      layout: "text-list",
      template: "swipe-rail",
      columns: { desktop: 7 },
      maxItems: 20,
    });
    const normalized = normalizeOptionalSectionContent("discovery", content);
    expect(normalized).toEqual(content);
    expect(Object.keys(normalized ?? {})).toEqual(Object.keys(content ?? {}));
  });

  it("reset to inherited deletes the key from the saved content", async () => {
    const stored = { ...LEGACY, layout: "carousel", gap: "loose" };
    const onChange = renderPanel(withDiscovery(stored));
    await screen.findByLabelText("Dimension");
    const layout = document.querySelector('[data-dd-control="layout"]') as HTMLElement;
    fireEvent.click(within(layout).getByRole("button", { name: /Reset to inherited/ }));
    const content = lastContent(onChange);
    expect(content).toEqual({ ...LEGACY, gap: "loose" });
    expect("layout" in (content ?? {})).toBe(false);
  });

  it("renaming keeps every display setting, including ones set through the new controls (round trip)", async () => {
    const stored = { ...LEGACY, template: "boutique-arches", columns: { mobile: 3 }, shape: "heart", showCounts: true };
    const onChange = renderPanel(withDiscovery(stored));
    await screen.findByLabelText("Dimension");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "تسوّق حسب المناسبة" } });
    expect(lastContent(onChange)).toEqual({ ...stored, title: "تسوّق حسب المناسبة" });
  });

  it("a stored setting survives switching to the facet axis before a dimension is chosen", async () => {
    const stored = { title: "", axis: "brand", display: "tiles", layout: "icon-grid", gap: "tight" };
    const onChange = renderPanel(withDiscovery(stored));
    await screen.findByLabelText("Browse by");
    fireEvent.change(screen.getByLabelText("Browse by"), { target: { value: "facet" } });
    expect(lastContent(onChange)).toBeUndefined(); // incomplete: nothing usable yet
    // Editing a display setting while incomplete commits nothing but is kept…
    fireEvent.click(within(document.querySelector('[data-dd-control="layout"]') as HTMLElement).getByRole("button", { name: "Text list" }));
    expect(lastContent(onChange)).toBeUndefined();
    // …and arrives with the dimension once it is chosen.
    fireEvent.change(await screen.findByLabelText("Dimension"), { target: { value: "occasion" } });
    expect(lastContent(onChange)).toEqual({
      title: "",
      axis: "facet",
      dimension: "occasion",
      display: "tiles",
      layout: "text-list",
      gap: "tight",
    });
  });

  it("the preview uses the merchant's real facet values for the chosen dimension", async () => {
    renderPanel(withDiscovery({ ...LEGACY, layout: "image-grid" }));
    await waitFor(() =>
      expect(document.querySelector("[data-discovery-preview]")?.textContent).toContain("Your catalog's values and pictures"),
    );
    const preview = document.querySelector("[data-preview-layout]") as HTMLElement;
    expect(within(preview).getByText("Birthday")).toBeTruthy();
    expect(within(preview).getByText("Wedding")).toBeTruthy();
  });

  it("the Arabic UI shows Arabic labels, the badge and the reset action", async () => {
    renderPanel(withDiscovery({ ...LEGACY, template: "gift-circles", gap: "loose" }), "ar");
    await screen.findByLabelText("البُعد");
    expect(display().getByRole("button", { name: /^التخطيط/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /دوائر الهدايا/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(display().getByRole("button", { name: /^متقدّم/ }));
    const gap = document.querySelector('[data-dd-control="gap"]') as HTMLElement;
    expect(within(gap).getByText("قيمة صريحة")).toBeTruthy();
    expect(within(gap).getByRole("button", { name: /إعادة إلى الموروث/ })).toBeTruthy();
    expect((document.querySelector("[data-preview-layout]") as HTMLElement).getAttribute("dir")).toBe("rtl");
  });
});
