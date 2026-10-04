/**
 * @vitest-environment jsdom
 *
 * FLOWERS-H9c / ADR-21 — editors for the data-backed home sections. They edit
 * references and text only and commit `undefined` content while a choice is
 * incomplete, so the builder's normalizer never sees a half-built section.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";

const merchandising = vi.hoisted(() => ({
  loadCollections: vi.fn(),
  loadFacets: vi.fn(),
}));

vi.mock("@/modules/commerce-workspace/merchandising/client", () => merchandising);

const COLLECTIONS = [
  { id: "c1", slug: "roses", title: "ورود", titleEn: "Roses", description: null, status: "active", sortOrder: 0, memberCount: 3 },
  { id: "c2", slug: "draft-one", title: "مسودة", titleEn: null, description: null, status: "draft", sortOrder: 1, memberCount: 0 },
];

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
      { id: "v2", slug: "retired", name: "قديم", nameEn: "Retired", sortOrder: 1, isActive: false, productCount: 0 },
    ],
  },
  { id: "f2", key: "off", systemKey: null, name: "معطل", nameEn: null, sortOrder: 1, isActive: false, values: [] },
];

function withSection(
  type: "productShelf" | "discovery" | "deliveryPromise",
  content?: unknown,
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [{ id: "s1", type, visible: true, content } as never],
    },
  };
}

function renderPanel(config: StorefrontPresentationConfig, onChange = vi.fn()) {
  render(
    <ControlPanels
      panel="homepage"
      config={config}
      locale="en"
      liveStoreName={null}
      onChange={onChange}
      selectedSection="s1"
    />,
  );
  return onChange;
}

function lastContent(onChange: ReturnType<typeof vi.fn>): unknown {
  const calls = onChange.mock.calls;
  const next = calls[calls.length - 1][0] as StorefrontPresentationConfig;
  return next.homepage.sections[0].content;
}

describe("Store Builder — data-backed section editors (ADR-21)", () => {
  beforeEach(() => {
    merchandising.loadCollections.mockResolvedValue(COLLECTIONS);
    merchandising.loadFacets.mockResolvedValue(FACETS);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("productShelf", () => {
    it("offers only active collections and commits the slug (a reference), never resolved data", async () => {
      const onChange = renderPanel(withSection("productShelf"));
      fireEvent.change(screen.getByLabelText("Product source"), { target: { value: "collection" } });
      // Incomplete so far: nothing usable is committed.
      expect(lastContent(onChange)).toBeUndefined();
      const select = (await screen.findByLabelText("Collection")) as HTMLSelectElement;
      const labels = Array.from(select.options).map((o) => o.textContent);
      expect(labels).toContain("Roses");
      expect(labels).not.toContain("مسودة");
      fireEvent.change(select, { target: { value: "roses" } });
      expect(lastContent(onChange)).toEqual({
        title: "",
        source: { kind: "collection", slug: "roses" },
        deliverToday: false,
        limit: 8,
      });
    });

    it("offers only active facets/values and needs both before committing a facet source", async () => {
      const onChange = renderPanel(withSection("productShelf"));
      fireEvent.change(screen.getByLabelText("Product source"), { target: { value: "facet" } });
      const facet = (await screen.findByLabelText("Dimension")) as HTMLSelectElement;
      expect(Array.from(facet.options).map((o) => o.textContent)).not.toContain("معطل");
      fireEvent.change(facet, { target: { value: "occasion" } });
      expect(lastContent(onChange)).toBeUndefined();
      const value = screen.getByLabelText("Value") as HTMLSelectElement;
      expect(Array.from(value.options).map((o) => o.textContent)).not.toContain("Retired");
      fireEvent.change(value, { target: { value: "birthday" } });
      expect(lastContent(onChange)).toMatchObject({
        source: { kind: "facet", key: "occasion", value: "birthday" },
      });
    });

    it("'Deliver today only' alone is a complete shelf, and shows the incomplete warning otherwise", () => {
      const onChange = renderPanel(withSection("productShelf"));
      expect(document.querySelector("[data-section-incomplete]")).not.toBeNull();
      fireEvent.click(screen.getByRole("checkbox", { name: "Deliver today only" }));
      expect(lastContent(onChange)).toEqual({ title: "", deliverToday: true, limit: 8 });
      expect(document.querySelector("[data-section-incomplete]")).toBeNull();
    });

    it("keeps a stored collection slug selectable even when it is no longer in the active list", async () => {
      renderPanel(withSection("productShelf", { title: "", source: { kind: "collection", slug: "gone" }, deliverToday: false, limit: 8 }));
      const select = (await screen.findByLabelText("Collection")) as HTMLSelectElement;
      expect(select.value).toBe("gone");
    });

    it("shows a retryable error when collections cannot be loaded", async () => {
      merchandising.loadCollections.mockResolvedValueOnce(null).mockResolvedValue(COLLECTIONS);
      renderPanel(withSection("productShelf", { title: "", source: { kind: "collection", slug: "roses" }, deliverToday: false, limit: 8 }));
      const alert = await screen.findByRole("alert");
      fireEvent.click(alert.querySelector("button") as HTMLButtonElement);
      await waitFor(() => expect(screen.getByLabelText("Collection")).toBeTruthy());
    });
  });

  describe("discovery", () => {
    it("commits nothing for a facet axis until a dimension is chosen; brand axis needs no dimension", async () => {
      const onChange = renderPanel(withSection("discovery"));
      const dimension = (await screen.findByLabelText("Dimension")) as HTMLSelectElement;
      fireEvent.change(dimension, { target: { value: "occasion" } });
      expect(lastContent(onChange)).toEqual({ title: "", axis: "facet", dimension: "occasion", display: "tiles" });
      fireEvent.change(screen.getByLabelText("Browse by"), { target: { value: "brand" } });
      expect(lastContent(onChange)).toEqual({ title: "", axis: "brand", display: "tiles" });
      expect(screen.queryByLabelText("Dimension")).toBeNull();
    });

    it("flags an incomplete facet section", () => {
      const onChange = renderPanel(withSection("discovery"));
      expect(document.querySelector("[data-section-incomplete]")).not.toBeNull();
      fireEvent.change(screen.getByLabelText("Display"), { target: { value: "chips" } });
      expect(lastContent(onChange)).toBeUndefined();
    });
  });

  describe("deliveryPromise", () => {
    it("commits text only, and nothing when both fields are empty (the date is never entered here)", () => {
      const onChange = renderPanel(withSection("deliveryPromise"));
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fresh today" } });
      expect(lastContent(onChange)).toEqual({ title: "Fresh today", body: "" });
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
      expect(lastContent(onChange)).toBeUndefined();
    });
  });
});
