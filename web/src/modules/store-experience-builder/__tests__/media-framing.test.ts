import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRAMING,
  applyFraming,
  clampCrop,
  focalFromPoint,
  framingOf,
  isDefaultFraming,
  maxCrop,
  moveCrop,
  nextRotation,
  rotatedDims,
  rotatedImageStyle,
  setZoom,
} from "../media/framing";
import { normalizeMediaRef, type MediaRef } from "../presentation/media-ref";

const ID = "0b9d6a3e-1f5c-4a8e-9a47-2c1d3e4f5a6b";

describe("media framing geometry (V4b)", () => {
  it("swaps the axes for 90/270 rotations only", () => {
    expect(rotatedDims({ w: 4000, h: 3000 }, 0)).toEqual({ w: 4000, h: 3000 });
    expect(rotatedDims({ w: 4000, h: 3000 }, 90)).toEqual({ w: 3000, h: 4000 });
    expect(rotatedDims({ w: 4000, h: 3000 }, 180)).toEqual({ w: 4000, h: 3000 });
    expect(rotatedDims({ w: 4000, h: 3000 }, 270)).toEqual({ w: 3000, h: 4000 });
    expect(nextRotation(270)).toBe(0);
  });

  it("builds the largest centred crop of each preset on a wide and a tall image", () => {
    // 4:3 image, 16:9 frame → full width, 75 % height
    const wide = maxCrop("16:9", { w: 4000, h: 3000 });
    expect(wide).toEqual({ x: 0, y: 0.125, w: 1, h: 0.75, aspect: "16:9" });
    // 4:3 image, 1:1 frame → full height, 75 % width
    const square = maxCrop("1:1", { w: 4000, h: 3000 });
    expect(square).toEqual({ x: 0.125, y: 0, w: 0.75, h: 1, aspect: "1:1" });
    // the crop's pixel ratio really is the preset ratio
    for (const aspect of ["16:5", "3:1", "16:9", "4:3", "1:1", "4:5"] as const) {
      const dims = { w: 3000, h: 4000 };
      const c = maxCrop(aspect, dims);
      const [a, b] = aspect.split(":").map(Number);
      expect((c.w * dims.w) / (c.h * dims.h)).toBeCloseTo(a / b, 2);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1.0001);
      expect(c.y + c.h).toBeLessThanOrEqual(1.0001);
    }
  });

  it("keeps a moved crop inside the image and never resizes it", () => {
    const crop = maxCrop("1:1", { w: 4000, h: 3000 });
    const moved = moveCrop(crop, 5, 5);
    expect(moved.x).toBeCloseTo(1 - crop.w, 4);
    expect(moved.w).toBe(crop.w);
    expect(moveCrop(crop, -5, 0).x).toBe(0);
    expect(clampCrop({ x: -1, y: 2, w: 0.5, h: 0.5, aspect: "1:1" })).toMatchObject({ x: 0, y: 0.5 });
  });

  it("clamps zoom to 1–4 and omits it at 1", () => {
    const crop = maxCrop("16:9", { w: 4000, h: 3000 });
    expect(setZoom(crop, 9).zoom).toBe(4);
    expect(setZoom(crop, 2.504).zoom).toBe(2.5);
    expect("zoom" in setZoom({ ...crop, zoom: 2 }, 1)).toBe(false);
    expect("zoom" in setZoom(crop, 0.2)).toBe(false);
  });

  it("maps a click to a 0–100 focal point and clamps at the edges", () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    expect(focalFromPoint(200, 100, rect)).toEqual({ x: 50, y: 50 });
    expect(focalFromPoint(0, 1000, rect)).toEqual({ x: 0, y: 100 });
    expect(focalFromPoint(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 50, y: 50 });
  });

  it("reads defaults from a bare reference and recognises the default framing", () => {
    const f = framingOf({ mediaId: ID });
    expect(f).toEqual({ crop: undefined, rotate: 0, focal: { x: 50, y: 50 }, fit: "cover" });
    expect(isDefaultFraming(f)).toBe(true);
    expect(isDefaultFraming({ ...f, fit: "contain" })).toBe(false);
  });

  it("never stores defaults and keeps alt/decorative untouched when applying", () => {
    const ref: MediaRef = { mediaId: ID, alt: { ar: "شعار", en: "Logo" }, decorative: true };
    expect(applyFraming(ref, DEFAULT_FRAMING)).toEqual(ref);
    const framed = applyFraming(ref, {
      crop: maxCrop("1:1", { w: 100, h: 100 }),
      rotate: 90,
      focal: { x: 20, y: 80 },
      fit: "contain",
    });
    expect(Object.keys(framed)).toEqual(["mediaId", "fit", "focal", "crop", "rotate", "alt", "decorative"]);
    expect(framed.alt).toEqual({ ar: "شعار", en: "Logo" });
    // replacing a framing with the default removes the old one completely
    expect(applyFraming(framed, DEFAULT_FRAMING)).toEqual(ref);
  });

  it("produces references the contract normaliser accepts byte-for-byte", () => {
    const natural = { w: 4000, h: 3000 };
    for (const rotate of [0, 90, 180, 270] as const) {
      for (const aspect of ["16:5", "16:9", "1:1", "4:5"] as const) {
        const crop = setZoom(maxCrop(aspect, rotatedDims(natural, rotate)), 2.25);
        const ref = applyFraming({ mediaId: ID }, { crop, rotate, focal: { x: 33, y: 71 }, fit: "contain" });
        expect(normalizeMediaRef(JSON.parse(JSON.stringify(ref)))).toEqual(ref);
      }
    }
  });

  it("sizes a rotated image to fill the swapped box", () => {
    expect(rotatedImageStyle({ w: 400, h: 300 }, 0)).toMatchObject({ width: "100%", height: "100%" });
    const s = rotatedImageStyle({ w: 400, h: 300 }, 90);
    expect(s.width).toBe("133.3333%");
    expect(s.height).toBe("75%");
    expect(s.transform).toContain("rotate(90deg)");
  });
});
