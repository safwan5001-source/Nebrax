/**
 * @vitest-environment jsdom
 *
 * AWJ-VD-H1 / VD-5 (owner-reported defect) — the discovery panel preview must draw the merchant's REAL value pictures.
 *
 * The owner added real images (heart and circle shapes) to dimension values, put a Discovery section on the page and
 * saw coloured placeholder pictures and fallback icons instead. Cause: the preview invented the looks ("looks are
 * always samples, because the builder does not read value visuals") although the dimension list the builder already
 * loads carries every value's stored look and a signed thumbnail. These tests pin the fix:
 *  - a real value is drawn from ITS stored look and its signed thumbnail;
 *  - a value whose picture cannot be shown falls back like the store does AND the panel says why;
 *  - the sample look is always labelled as a sample, with the reason, and never leaks into a real dimension;
 *  - «follows the template» is a visible, named, reversible state (inheritance), distinct from picking a template.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Facet, FacetValue } from "@/modules/commerce-workspace/merchandising/client";
import { DiscoveryDisplayFields } from "../DiscoveryDisplayFields";
import type { DiscoveryDisplayOptions } from "../discovery-display-edit";
import { previewNotes, previewSource } from "../discovery-preview-model";
import { type CustomizerLocale, customizerMessage } from "../messages";
import type { DiscoveryContent } from "../presentation/section-content";

afterEach(cleanup);

/** A valid (lowercase v4-shaped) media id derived from a short name: the identity normalizer drops anything else. */
const mediaId = (name: string) => `aaaaaaaa-bbbb-4ccc-8ddd-${Array.from(name).reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 1e12, 7).toString().padStart(12, "0")}`;

const THUMB = (name: string, size: 160 | 320) =>
  `http://127.0.0.1:8000/api/commerce/workspace/storefront-media/${mediaId(name)}/variants/thumb-${size}.webp?expires=9999999999&tenant=t&signature=s-${name}`;

function value(over: Partial<FacetValue> & Pick<FacetValue, "id" | "slug" | "name">): FacetValue {
  return {
    nameEn: null,
    sortOrder: 0,
    isActive: true,
    productCount: 2,
    visual: null,
    visualVersion: null,
    visualPreview: null,
    ...over,
  };
}

/** A value with a stored picture: `visual.image.mediaId` and the signed thumbnails the list endpoint attaches. */
function withPicture(id: string, name: string, shape: "heart" | "circle", over: Partial<FacetValue> = {}): FacetValue {
  return value({
    id,
    slug: id,
    name,
    nameEn: name,
    sortOrder: Number(over.sortOrder ?? 0),
    visual: { content: "image", image: { mediaId: mediaId(`m-${id}`), fit: "cover" }, shape, size: "md", showLabel: true } as FacetValue["visual"],
    visualPreview: { thumb160: THUMB(`m-${id}`, 160), thumb320: THUMB(`m-${id}`, 320) },
    ...over,
  });
}

function facet(values: FacetValue[], key = "recipient"): Facet {
  return { id: "f1", key, systemKey: null, name: "المُهدى إليه", nameEn: "Recipient", sortOrder: 0, isActive: true, values, visual: null, visualVersion: null, visualPreview: null };
}

const BASE: Pick<DiscoveryContent, "title" | "axis" | "dimension" | "display"> = {
  title: "Shop by recipient",
  axis: "facet",
  dimension: "recipient",
  display: "tiles",
};

function Harness({
  facets,
  initial = { layout: "image-grid" },
  locale = "en",
  base = BASE,
  onOptions,
  onReload,
}: {
  facets: readonly Facet[] | null;
  initial?: DiscoveryDisplayOptions;
  locale?: CustomizerLocale;
  base?: typeof BASE;
  onOptions?: (options: DiscoveryDisplayOptions) => void;
  onReload?: () => void;
}) {
  const [options, setOptions] = useState<DiscoveryDisplayOptions>(initial);
  return (
    <DiscoveryDisplayFields
      base={base}
      options={options}
      onOptionsChange={(next) => {
        setOptions(next);
        onOptions?.(next);
      }}
      locale={locale}
      t={(key) => customizerMessage(locale, key)}
      facets={facets}
      onReloadFacets={onReload}
    />
  );
}

const previewEl = () => document.querySelector("[data-discovery-preview]") as HTMLElement;
const images = () => Array.from(previewEl().querySelectorAll<HTMLImageElement>("[data-preview-item] img"));
const itemOf = (label: string) =>
  Array.from(previewEl().querySelectorAll<HTMLElement>("[data-preview-item]")).find((el) => el.textContent?.includes(label)) as HTMLElement;
const contentOf = (label: string) => itemOf(label).querySelector("[data-facet-content]")?.getAttribute("data-facet-content");
const noteEl = (note: string) => previewEl().querySelector(`[data-preview-note="${note}"]`) as HTMLElement | null;

describe("real values are drawn from their stored look", () => {
  const facets = [facet([withPicture("mom", "Mom", "heart", { sortOrder: 0 }), withPicture("dad", "Dad", "circle", { sortOrder: 1 })])];

  it("the picture of a value with an image is its signed thumbnail, never a placeholder", () => {
    render(<Harness facets={facets} />);
    const sources = images().map((img) => img.getAttribute("src"));
    expect(sources).toEqual([THUMB("m-mom", 320), THUMB("m-dad", 320)]);
    expect(images()[0].getAttribute("srcset")).toContain(`${THUMB("m-mom", 160)} 160w`);
    expect(sources.every((src) => !src?.startsWith("data:"))).toBe(true);
  });

  it("keeps each value's own shape (heart vs circle) and never leaks the placeholder media ids or pictures", () => {
    render(<Harness facets={facets} />);
    const frame = (label: string) => itemOf(label).querySelector("[data-facet-content] > span[aria-hidden='true']") as HTMLElement;
    expect(frame("Mom").getAttribute("style")).not.toEqual(frame("Dad").getAttribute("style"));
    expect(frame("Dad").style.borderRadius).toBe("50%");
    expect(frame("Mom").style.borderRadius).not.toBe("50%");
    expect(previewEl().innerHTML).not.toContain("00000000-0000-4000-8000");
    expect(previewEl().querySelector("img[src^='data:']")).toBeNull(); // (the heart mask is a CSS data: URL; no picture is)
  });

  it("a section-level shape still overrides the value's own, as in the store", () => {
    render(<Harness facets={facets} initial={{ layout: "image-grid", shape: "circle" }} />);
    const frames = Array.from(previewEl().querySelectorAll<HTMLElement>("[data-facet-content] > span[aria-hidden='true']"));
    expect(frames.map((f) => f.style.borderRadius)).toEqual(["50%", "50%"]);
  });

  it("icon-grid draws the icon first (the fallback icon of an image value), then the image", () => {
    const iconic = value({
      id: "gift",
      slug: "gift",
      name: "Gift",
      visual: { content: "image", image: { mediaId: mediaId("m-gift"), fit: "cover" }, icon: "gift", shape: "circle" } as FacetValue["visual"],
      visualPreview: { thumb160: THUMB("m-gift", 160), thumb320: THUMB("m-gift", 320) },
    });
    render(<Harness facets={[facet([iconic])]} initial={{ layout: "icon-grid" }} />);
    expect(contentOf("Gift")).toBe("icon");
    expect(images()).toHaveLength(0);
  });
});

describe("a value that cannot be drawn as its picture says why", () => {
  it("a stored image with no preview link falls back like the store and is named as unavailable", () => {
    const broken = withPicture("eid", "Eid", "heart", { visualPreview: null });
    render(<Harness facets={[facet([withPicture("mom", "Mom", "heart"), broken])]} />);
    expect(contentOf("Mom")).toBe("image");
    expect(contentOf("Eid")).not.toBe("image");
    expect(noteEl("image_unavailable")?.textContent).toContain("Eid");
    expect(noteEl("image_unavailable")?.textContent).not.toContain("Mom");
    expect(noteEl("image_unavailable")?.textContent).toContain("preview is not available");
  });

  it("a value with no look at all is said to have none; a value with no products is said not to be listed", () => {
    const facets = [
      facet([
        withPicture("mom", "Mom", "heart"),
        value({ id: "kid", slug: "kid", name: "Kid", sortOrder: 1 }),
        withPicture("friend", "Friend", "heart", { sortOrder: 2, productCount: 0 }),
      ]),
    ];
    render(<Harness facets={facets} />);
    expect(noteEl("no_look")?.textContent).toContain("Kid");
    expect(noteEl("no_products")?.textContent).toContain("Friend");
    expect(noteEl("no_products")?.textContent).not.toContain("Mom");
    // The valueless-of-products value still shows its real picture: the note explains the store, it does not hide it.
    expect(contentOf("Friend")).toBe("image");
  });

  it("inactive values are not drawn and their number is said; the store rule about unpublished products is always said", () => {
    const facets = [facet([withPicture("mom", "Mom", "heart"), withPicture("old", "Old", "circle", { isActive: false })])];
    render(<Harness facets={facets} />);
    expect(itemOf("Old")).toBeUndefined();
    expect(noteEl("inactive")?.textContent).toContain("(1)");
    expect(noteEl("store_rule")?.textContent).toContain("published product");
  });

  it("text-list and the legacy look draw names only, so only the products note applies", () => {
    const facets = [facet([value({ id: "kid", slug: "kid", name: "Kid", productCount: 0 }), withPicture("eid", "Eid", "heart", { visualPreview: null })])];
    render(<Harness facets={facets} initial={{ layout: "text-list" }} />);
    expect(noteEl("no_look")).toBeNull();
    expect(noteEl("image_unavailable")).toBeNull();
    expect(noteEl("no_products")?.textContent).toContain("Kid");
  });

  it("a thumbnail that fails to load falls back, is reported with the reload action, and the reload hook is called", () => {
    const onReload = vi.fn();
    render(<Harness facets={[facet([withPicture("mom", "Mom", "heart")])]} onReload={onReload} />);
    expect(noteEl("image_failed")).toBeNull();
    fireEvent.error(images()[0]);
    expect(images()).toHaveLength(0);
    expect(contentOf("Mom")).not.toBe("image");
    expect(noteEl("image_failed")?.textContent).toContain("Mom");
    fireEvent.click(screen.getByRole("button", { name: "Reload the preview" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("a fresh signed link (after a reload) is tried again: the failure is remembered per link", () => {
    const { rerender } = render(<Harness facets={[facet([withPicture("mom", "Mom", "heart")])]} />);
    fireEvent.error(images()[0]);
    expect(images()).toHaveLength(0);
    const renewed = withPicture("mom", "Mom", "heart", {
      visualPreview: { thumb160: `${THUMB("m-mom", 160)}&n=2`, thumb320: `${THUMB("m-mom", 320)}&n=2` },
    });
    rerender(<Harness facets={[facet([renewed])]} />);
    expect(images()).toHaveLength(1);
    expect(noteEl("image_failed")).toBeNull();
  });

  it("the notices are announced (status region) and sit outside the hidden picture frame", () => {
    render(<Harness facets={[facet([value({ id: "kid", slug: "kid", name: "Kid" })])]} />);
    const notices = previewEl().querySelector("[data-preview-notices]") as HTMLElement;
    expect(notices.getAttribute("role")).toBe("status");
    expect(notices.closest("[aria-hidden='true']")).toBeNull();
  });
});

describe("samples are labelled as samples, with the reason", () => {
  const modeOf = () => previewEl().querySelector("[data-preview-mode]") as HTMLElement;

  it("no dimension chosen: placeholders, a visible badge in the frame and a status line saying they are not yours", () => {
    render(<Harness facets={[facet([withPicture("mom", "Mom", "heart")])]} base={{ ...BASE, dimension: "" }} />);
    expect(modeOf().getAttribute("data-preview-mode")).toBe("sample");
    expect(modeOf().getAttribute("data-preview-sample-reason")).toBe("no_dimension");
    expect(modeOf().textContent).toContain("not from your store");
    expect(previewEl().querySelector("[data-preview-sample-badge]")?.textContent).toBe("Sample");
  });

  it("dimension list not loaded: samples, reason loading", () => {
    render(<Harness facets={null} />);
    expect(modeOf().getAttribute("data-preview-sample-reason")).toBe("loading");
    expect(modeOf().textContent).toContain("have not loaded yet");
  });

  it("brand axis and a dimension with no active values: samples, with their own reasons", () => {
    render(<Harness facets={[facet([])]} />);
    expect(modeOf().getAttribute("data-preview-sample-reason")).toBe("empty");
    cleanup();
    render(<Harness facets={[facet([])]} base={{ title: "t", axis: "brand", display: "tiles" }} />);
    expect(modeOf().getAttribute("data-preview-sample-reason")).toBe("brand");
  });

  it("a real dimension is labelled as the merchant's own and carries no sample badge", () => {
    render(<Harness facets={[facet([withPicture("mom", "Mom", "heart")])]} />);
    expect(modeOf().getAttribute("data-preview-mode")).toBe("real");
    expect(modeOf().textContent).toContain("Your catalog");
    expect(previewEl().querySelector("[data-preview-sample-badge]")).toBeNull();
  });

  it("the Arabic copy is real Arabic (no English leaks into the notices)", () => {
    render(<Harness locale="ar" facets={[facet([value({ id: "kid", slug: "kid", name: "طفل", productCount: 0 })])]} />);
    expect(noteEl("no_products")?.textContent).toMatch(/[؀-ۿ]/);
    expect(noteEl("no_products")?.textContent).toContain("طفل");
    expect(noteEl("store_rule")?.textContent).toMatch(/[؀-ۿ]/);
  });
});

describe("model", () => {
  it("previewSource reports why it is a sample, and keeps the stored look of real values", () => {
    const f = [facet([withPicture("mom", "Mom", "heart")])];
    expect(previewSource({ facets: null, axis: "facet", dimension: "recipient", locale: "en" }).reason).toBe("loading");
    expect(previewSource({ facets: f, axis: "facet", dimension: "", locale: "en" }).reason).toBe("no_dimension");
    const real = previewSource({ facets: f, axis: "facet", dimension: "recipient", locale: "en" });
    expect(real.kind).toBe("real");
    expect(real.values[0].stored?.image?.src).toBe(THUMB("m-mom", 320));
  });

  it("previewNotes: picture + link = none; picture without link = unavailable; nothing set = no_look; zero products = no_products", () => {
    const src = (v: FacetValue) => previewSource({ facets: [facet([v])], axis: "facet", dimension: "recipient", locale: "en" }).values[0];
    expect(previewNotes(src(withPicture("a", "A", "heart")), { media: true })).toEqual([]);
    expect(previewNotes(src(withPicture("a", "A", "heart", { visualPreview: null })), { media: true })).toEqual(["image_unavailable"]);
    expect(previewNotes(src(value({ id: "k", slug: "k", name: "K", productCount: 0 })), { media: true })).toEqual(["no_look", "no_products"]);
  });
});

describe("«follows the template» is a named state, not a second template picker", () => {
  const SAMPLE_FACETS = null;
  const followButton = () => document.querySelector("[data-dd-control='layout'] button:not([data-dd-reset])") as HTMLButtonElement;

  function openLayout() {
    const button = screen.getByRole("button", { name: /^Layout/ });
    if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  }

  it("is a pressed, never-disabled state whose hint names the template and the layout it brings", () => {
    render(<Harness facets={SAMPLE_FACETS} initial={{ template: "gift-circles" }} />);
    openLayout();
    expect(followButton().textContent).toBe("Follow template");
    expect(followButton().disabled).toBe(false);
    expect(followButton().getAttribute("aria-pressed")).toBe("true");
    const hint = document.querySelector("[data-layout-hint]") as HTMLElement;
    expect(hint.getAttribute("data-layout-hint")).toBe("follow");
    expect(hint.textContent).toContain("follows the template “Gift circles” (Image grid)");
  });

  it("choosing a layout overrides the template (and says so); pressing «follow template» returns to it and deletes the key", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness facets={SAMPLE_FACETS} initial={{ template: "gift-circles" }} onOptions={(o) => seen.push(o)} />);
    openLayout();
    fireEvent.click(screen.getByRole("button", { name: /Carousel/ }));
    expect(seen.at(-1)).toMatchObject({ template: "gift-circles", layout: "carousel" });
    expect((document.querySelector("[data-layout-hint]") as HTMLElement).getAttribute("data-layout-hint")).toBe("override");
    fireEvent.click(followButton());
    expect(seen.at(-1)).toEqual({ template: "gift-circles" }); // nothing stored but the template id; layout key deleted
    expect((document.querySelector("[data-layout-hint]") as HTMLElement).getAttribute("data-layout-hint")).toBe("follow");
  });

  it("without a template the same button keeps its legacy meaning and there is no template hint", () => {
    render(<Harness facets={SAMPLE_FACETS} initial={{}} />);
    openLayout();
    expect(followButton().textContent).toBe("Legacy (tiles/chips)");
    expect(document.querySelector("[data-layout-hint]")).toBeNull();
  });
});
