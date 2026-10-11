import { describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "../config";
import type { ResolvedMedia, ResolvedMediaMap } from "../media-ref";
import type { DesignContext } from "../section-design-resolve";
import type { SliderContent } from "../slider-content";
import { resolveSlider, slidePicturePath } from "../slider-resolve";

const ID_A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const ID_B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const ctx: DesignContext = {
  primaryColor: "#12372a",
  accentColor: null,
  dir: "ltr",
};

function media(
  over: Partial<ResolvedMedia> & {
    bounds?: [number[], number[]] | null;
  } = {},
): ResolvedMedia {
  const { bounds, ...rest } = over;
  return {
    width: 1600,
    height: 900,
    decorative: false,
    alt: { ar: "صورة", en: "Picture" },
    sources: [
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "webp",
        src: "/api/storefront/media/customizer/x/w800.webp",
      },
    ],
    ...(bounds === null
      ? {}
      : {
          contrast: {
            min: (bounds ?? [
              [0, 0, 0],
              [40, 50, 60],
            ])[0] as [number, number, number],
            max: (bounds ?? [
              [0, 0, 0],
              [40, 50, 60],
            ])[1] as [number, number, number],
          },
        }),
    ...rest,
  };
}

function section(content: SliderContent): PresentationHomeSection {
  return { id: "sl", type: "slider", visible: true, content };
}

const slide = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  media: { mediaId: ID_A },
  ...extra,
});

function resolvedFor(
  entries: Array<[number, "media" | "mobile", ResolvedMedia]>,
  sectionIndex = 3,
): ResolvedMediaMap {
  const out: ResolvedMediaMap = {};
  for (const [j, key, m] of entries)
    out[slidePicturePath(sectionIndex, j, key)] = m;
  return out;
}

describe("resolveSlider (V8b)", () => {
  it("draws the proven picture with the proven automatic colour and the solid button in that colour", () => {
    const view = resolveSlider(
      section({ slides: [slide("a", { heading: "Hi" }), slide("b")] }),
      3,
      resolvedFor([
        [0, "media", media()],
        [1, "media", media()],
      ]),
      ctx,
      "en",
    )!;
    expect(view.slides).toHaveLength(2);
    const [a, b] = view.slides;
    expect(a.surface).toBe("picture");
    expect(a.media).not.toBeNull();
    expect(a.foreground).toBe("#ffffff"); // a dark picture proves white
    expect(a.buttonLabel).toBe("#000000"); // the button is white; its label the better of black / white
    expect(a.alt).toBe("Picture");
    expect(b.foreground).toBeNull(); // no copy ⇒ nothing to colour
    expect(b.position).toBe(2);
  });

  it("a light picture proves black", () => {
    const view = resolveSlider(
      section({ slides: [slide("a", { heading: "Hi" })] }),
      3,
      resolvedFor([
        [
          0,
          "media",
          media({
            bounds: [
              [220, 220, 220],
              [255, 255, 255],
            ],
          }),
        ],
      ]),
      ctx,
      "en",
    )!;
    expect(view.slides[0].foreground).toBe("#000000");
    expect(view.slides[0].buttonLabel).toBe("#ffffff");
  });

  it("an explicit text colour is used when it is proven over the picture", () => {
    const view = resolveSlider(
      section({
        slides: [slide("a", { heading: "Hi", text: { hex: "#fffbe6" } })],
      }),
      3,
      resolvedFor([[0, "media", media()]]),
      ctx,
      "en",
    )!;
    expect(view.slides[0].surface).toBe("picture");
    expect(view.slides[0].foreground).toBe("#fffbe6");
  });

  it("an explicit colour that fails withholds the picture and falls back to the brand surface", () => {
    const view = resolveSlider(
      section({
        slides: [slide("a", { heading: "Hi", text: { hex: "#222222" } })],
      }),
      3,
      resolvedFor([[0, "media", media()]]),
      ctx,
      "en",
    )!;
    const s = view.slides[0];
    expect(s.surface).toBe("brand");
    expect(s.media).toBeNull();
    expect(s.overlay).toBeNull();
    expect(s.foreground).toBe("#ffffff"); // the brand is dark: best of white / black
  });

  it("copy over a picture with no proven bounds withholds the picture (fail-closed)", () => {
    const view = resolveSlider(
      section({ slides: [slide("a", { heading: "Hi" })] }),
      3,
      resolvedFor([[0, "media", media({ bounds: null })]]),
      ctx,
      "en",
    )!;
    expect(view.slides[0].surface).toBe("brand");
    expect(view.slides[0].media).toBeNull();
  });

  it("a slide with no copy shows its picture even without bounds", () => {
    const view = resolveSlider(
      section({ slides: [slide("a")] }),
      3,
      resolvedFor([[0, "media", media({ bounds: null })]]),
      ctx,
      "en",
    )!;
    expect(view.slides[0].surface).toBe("picture");
    expect(view.slides[0].media).not.toBeNull();
  });

  it("an incomplete button alone is not copy", () => {
    const view = resolveSlider(
      section({ slides: [slide("a", { cta: { label: "Shop", href: "" } })] }),
      3,
      resolvedFor([[0, "media", media({ bounds: null })]]),
      ctx,
      "en",
    )!;
    expect(view.slides[0].surface).toBe("picture");
    expect(view.slides[0].cta).toBeNull();
  });

  it("the phone picture must be proven too: a missing one withholds the picture", () => {
    const withMobile = slide("a", {
      heading: "Hi",
      mobile: { mediaId: ID_B, decorative: true },
    });
    const proven = resolveSlider(
      section({ slides: [withMobile] }),
      3,
      resolvedFor([
        [0, "media", media()],
        [0, "mobile", media()],
      ]),
      ctx,
      "en",
    )!;
    expect(proven.slides[0].surface).toBe("picture");
    expect(proven.slides[0].mobile).not.toBeNull();

    const widened = resolveSlider(
      section({ slides: [withMobile] }),
      3,
      resolvedFor([
        [0, "media", media()],
        [
          0,
          "mobile",
          media({
            bounds: [
              [200, 200, 200],
              [255, 255, 255],
            ],
          }),
        ],
      ]),
      ctx,
      "en",
    )!;
    expect(widened.slides[0].surface).toBe("brand"); // dark + light range: unprovable

    const missing = resolveSlider(
      section({ slides: [withMobile] }),
      3,
      resolvedFor([[0, "media", media()]]),
      ctx,
      "en",
    )!;
    expect(missing.slides[0].surface).toBe("brand");
  });

  it("the slide's overlay is resolved to a colour and a strength, and judged with the picture", () => {
    const wide = media({
      bounds: [
        [0, 0, 0],
        [255, 255, 255],
      ],
    });
    const bare = resolveSlider(
      section({ slides: [slide("a", { heading: "Hi" })] }),
      3,
      resolvedFor([[0, "media", wide]]),
      ctx,
      "en",
    )!;
    expect(bare.slides[0].surface).toBe("brand"); // full range: unprovable on its own
    const washed = resolveSlider(
      section({
        slides: [
          slide("a", {
            heading: "Hi",
            overlay: { color: { hex: "#000000" }, alpha: 70 },
          }),
        ],
      }),
      3,
      resolvedFor([[0, "media", wide]]),
      ctx,
      "en",
    )!;
    expect(washed.slides[0].surface).toBe("picture");
    expect(washed.slides[0].overlay).toEqual({ colour: "#000000", alpha: 0.7 });
    const role = resolveSlider(
      section({
        slides: [
          slide("a", { overlay: { color: { role: "brand" }, alpha: 40 } }),
        ],
      }),
      3,
      resolvedFor([[0, "media", wide]]),
      ctx,
      "en",
    )!;
    expect(role.slides[0].overlay).toEqual({ colour: "#12372a", alpha: 0.4 });
  });

  it("omits a slide whose picture the server did not resolve, and numbers what is drawn", () => {
    const view = resolveSlider(
      section({ slides: [slide("a"), slide("b"), slide("c")] }),
      3,
      resolvedFor([
        [0, "media", media()],
        [2, "media", media()],
      ]),
      ctx,
      "en",
    )!;
    expect(view.slides.map((s) => [s.id, s.position])).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });

  it("no resolvable slide ⇒ null (the section is omitted)", () => {
    expect(
      resolveSlider(section({ slides: [slide("a")] }), 3, {}, ctx, "en"),
    ).toBeNull();
    expect(
      resolveSlider(
        { id: "sl", type: "slider", visible: true },
        3,
        {},
        ctx,
        "en",
      ),
    ).toBeNull();
  });

  it("alt text is resolved per locale and never borrowed across; a decorative picture has none", () => {
    const m = media({ alt: { ar: "صورة", en: null } });
    const sections = section({ slides: [slide("a")] });
    const map = resolvedFor([[0, "media", m]]);
    expect(resolveSlider(sections, 3, map, ctx, "ar")!.slides[0].alt).toBe(
      "صورة",
    );
    expect(resolveSlider(sections, 3, map, ctx, "en")!.slides[0].alt).toBe("");
    expect(
      resolveSlider(
        sections,
        3,
        resolvedFor([[0, "media", media({ decorative: true })]]),
        ctx,
        "en",
      )!.slides[0].alt,
    ).toBe("");
  });

  it("focal points are each picture's own; alignment defaults to the inline start", () => {
    const view = resolveSlider(
      section({
        slides: [
          slide("a", {
            media: { mediaId: ID_A, focal: { x: 20, y: 80 } },
            mobile: {
              mediaId: ID_B,
              decorative: true,
              focal: { x: 70, y: 10 },
            },
            align: "end",
          }),
          slide("b"),
        ],
      }),
      3,
      resolvedFor([
        [0, "media", media()],
        [0, "mobile", media()],
        [1, "media", media()],
      ]),
      ctx,
      "en",
    )!;
    expect(view.slides[0].focal).toEqual({ x: 20, y: 80 });
    expect(view.slides[0].mobileFocal).toEqual({ x: 70, y: 10 });
    expect(view.slides[0].align).toBe("end");
    expect(view.slides[1].align).toBe("start");
    expect(view.slides[1].focal).toBeUndefined();
  });

  it("behaviour is resolved with every default explicit", () => {
    const view = resolveSlider(
      section({
        slides: [slide("a")],
        behaviour: { autoplay: true, interval: 8, transition: "fade" },
      }),
      3,
      resolvedFor([[0, "media", media()]]),
      ctx,
      "en",
    )!;
    expect(view.behaviour).toEqual({
      autoplay: true,
      interval: 8,
      transition: "fade",
      duration: "base",
      arrows: true,
      dots: true,
      loop: false,
    });
  });

  it("paths are keyed by the section's index in the whole list", () => {
    expect(slidePicturePath(5, 2, "mobile")).toBe(
      "homepage.sections.5.content.slides.2.mobile",
    );
  });
});
