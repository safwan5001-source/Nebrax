import { describe, expect, it } from "vitest";
import { createMediaFieldT } from "../media/media-field-messages";
import { fromFacetImage, toFacetImage } from "../media/facet-image";
import { customizerMessage } from "../messages";
import { normalizeFacetValueVisual, type FacetVisualImage } from "../presentation/facet-visual";
import type { MediaRef } from "../presentation/media-ref";
import { MEDIA_ID, MEDIA_ID_2 } from "./media-fixtures";

const framed: MediaRef = {
  mediaId: MEDIA_ID,
  fit: "contain",
  focal: { x: 20, y: 80 },
  crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, aspect: "1:1", zoom: 2 },
  rotate: 90,
  alt: { ar: "وردة", en: "Rose" },
  decorative: true,
};

describe("toFacetImage (VD-3 adapter)", () => {
  it("never emits crop or rotate, even from a ref that carries them", () => {
    const image = toFacetImage(framed);
    expect(image).not.toBeNull();
    expect(Object.keys(image as object).sort()).toEqual(["alt", "decorative", "mediaId"]);
    expect(image).not.toHaveProperty("crop");
    expect(image).not.toHaveProperty("rotate");
  });

  it("takes only the id, alt and decorative from the field — the ref's own fit and focal are ignored", () => {
    expect(toFacetImage({ mediaId: MEDIA_ID, fit: "contain", focal: { x: 1, y: 2 } })).toEqual({ mediaId: MEDIA_ID });
  });

  it("re-attaches the framing the appearance controls own while the same picture is kept", () => {
    const previous: FacetVisualImage = { mediaId: MEDIA_ID, fit: "contain", focal: { x: 20, y: 80 }, zoom: 1.4 };
    expect(toFacetImage({ mediaId: MEDIA_ID, alt: { ar: "وردة" } }, previous)).toEqual({
      mediaId: MEDIA_ID,
      fit: "contain",
      focal: { x: 20, y: 80 },
      zoom: 1.4,
      alt: { ar: "وردة" },
    });
  });

  it("a replacement keeps the fit but starts centred and unzoomed", () => {
    const previous: FacetVisualImage = { mediaId: MEDIA_ID, fit: "contain", focal: { x: 20, y: 80 }, zoom: 1.4 };
    expect(toFacetImage({ mediaId: MEDIA_ID_2 }, previous)).toEqual({ mediaId: MEDIA_ID_2, fit: "contain" });
  });

  it("maps a cleared field to null", () => {
    expect(toFacetImage(null)).toBeNull();
    expect(toFacetImage(undefined)).toBeNull();
  });

  it("its output is accepted unchanged by the identity normaliser (a fixed point)", () => {
    const image = toFacetImage(framed) as FacetVisualImage;
    expect(normalizeFacetValueVisual({ image }).image).toEqual(image);
  });
});

describe("fromFacetImage (VD-3 adapter)", () => {
  it("hands the field only the id, alt and decorative — never crop, rotate or any framing", () => {
    const ref = fromFacetImage({
      mediaId: MEDIA_ID,
      fit: "contain",
      focal: { x: 20, y: 80 },
      zoom: 1.4,
      alt: { en: "Rose" },
      decorative: true,
    });
    expect(ref).toEqual({ mediaId: MEDIA_ID, alt: { en: "Rose" }, decorative: true });
    expect(ref).not.toHaveProperty("crop");
    expect(ref).not.toHaveProperty("rotate");
    expect(ref).not.toHaveProperty("focal");
  });

  it("maps no image to null", () => {
    expect(fromFacetImage(undefined)).toBeNull();
    expect(fromFacetImage(null)).toBeNull();
  });

  it("round-trips through toFacetImage", () => {
    const image: FacetVisualImage = { mediaId: MEDIA_ID, alt: { ar: "وردة" } };
    expect(toFacetImage(fromFacetImage(image), image)).toEqual(image);
  });
});

describe("createMediaFieldT (message adapter)", () => {
  it("serves the shared media wording from the Customizer catalog in both languages", () => {
    expect(createMediaFieldT("en")("mediaPick")).toBe(customizerMessage("en", "mediaPick"));
    expect(createMediaFieldT("ar")("mediaPick")).toBe(customizerMessage("ar", "mediaPick"));
  });

  it("lets the surface override a phrase by key without touching the others", () => {
    const t = createMediaFieldT("en", { mediaDecorativeHint: "The link already carries the name." });
    expect(t("mediaDecorativeHint")).toBe("The link already carries the name.");
    expect(t("mediaRemove")).toBe(customizerMessage("en", "mediaRemove"));
  });
});
