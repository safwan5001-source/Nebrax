import { describe, expect, it } from "vitest";
import {
  customizerAnimatedPath,
  customizerMediaPath,
  isCustomizerAnimatedFile,
  isCustomizerMediaFile,
  isCustomizerProxyFile,
} from "@/lib/commerce/customizer-media";
import {
  animatedPictureSources,
  PHONE_QUERY,
  REDUCED_MOTION_QUERY,
} from "../animated-sources";
import type { ResolvedMedia } from "../media-ref";
import { readResolvedMedia } from "../resolved-media";

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const P = "/api/storefront/media/customizer/";

const still = (tag: string): ResolvedMedia["sources"] => [
  {
    kind: "w",
    width: 400,
    height: 400,
    format: "webp",
    src: `${P}${ID}/${tag}400w.webp`,
  },
  {
    kind: "w",
    width: 400,
    height: 400,
    format: "jpg",
    src: `${P}${ID}/${tag}400w.jpg`,
  },
];
const anim = (format: "gif" | "webp") => ({
  src: `${P}${ID}/animated.${format}`,
  format,
  frames: 3,
  durationMs: 600,
  loop: true,
});
const media = (over: Partial<ResolvedMedia> = {}): ResolvedMedia => ({
  width: 400,
  height: 400,
  decorative: true,
  alt: { ar: null, en: null },
  sources: still(""),
  ...over,
});

describe("customizer media path contract (animated)", () => {
  it("the animated file is a distinct, closed vocabulary — never part of the still-ladder contract", () => {
    expect(isCustomizerAnimatedFile("animated.gif")).toBe(true);
    expect(isCustomizerAnimatedFile("animated.webp")).toBe(true);
    for (const bad of [
      "animated.png",
      "animated.GIF",
      "animated.gif ",
      "x/animated.gif",
      "original.gif",
    ]) {
      expect(isCustomizerAnimatedFile(bad), bad).toBe(false);
    }
    expect(isCustomizerMediaFile("animated.gif")).toBe(false); // ladder sources can never smuggle it in
    expect(isCustomizerProxyFile("animated.gif")).toBe(true);
    expect(isCustomizerProxyFile("480w.webp")).toBe(true);
    expect(customizerMediaPath(ID, "animated.gif")).toBeNull();
    expect(customizerAnimatedPath(ID, "animated.gif")).toBe(
      `${P}${ID}/animated.gif`,
    );
    expect(
      customizerAnimatedPath(
        "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        "animated.gif",
      ),
    ).toBeNull(); // not a transform key
  });
});

describe("readResolvedMedia — animation", () => {
  const entry = (animation: unknown) => ({
    "homepage.sections.0.design.background.media": {
      width: 400,
      height: 400,
      decorative: true,
      alt: { ar: null, en: null },
      sources: still(""),
      animation,
    },
  });
  const read = (animation: unknown) =>
    readResolvedMedia(entry(animation))[
      "homepage.sections.0.design.background.media"
    ];

  it("keeps a valid animation and the still ladder", () => {
    const m = read({ ...anim("gif") });
    expect(m?.animation).toEqual(anim("gif"));
    expect(m?.sources.length).toBe(2);
  });

  it("drops (never repairs) an animation outside the contract — the still image still renders", () => {
    const bad: unknown[] = [
      { ...anim("gif"), src: "https://evil.example/animated.gif" },
      { ...anim("gif"), src: `/store/v1/media/customizer/${ID}/animated.gif` }, // raw origin path
      { ...anim("gif"), src: `${P}${ID}/animated.webp` }, // format ≠ file
      { ...anim("gif"), src: `${P}${ID}/../animated.gif` },
      {
        ...anim("gif"),
        src: `${P}a1b2c3d4e5f60718293a4b5c6d7e8f90/animated.gif`,
      }, // transform key
      { ...anim("gif"), format: "png" },
      { ...anim("gif"), frames: 1 },
      { ...anim("gif"), durationMs: 0 },
      "animated.gif",
      null,
    ];
    for (const animation of bad) {
      const m = read(animation);
      expect(m, JSON.stringify(animation)).toBeDefined();
      expect(m?.animation, JSON.stringify(animation)).toBeUndefined();
      expect(m?.sources.length).toBe(2);
    }
  });
});

describe("animatedPictureSources — ordering is the contract", () => {
  it("is null (callers keep their original markup) when nothing is animated", () => {
    expect(animatedPictureSources(media(), undefined)).toBeNull();
    expect(animatedPictureSources(media(), media())).toBeNull();
  });

  it("desktop-only animation: reduced-motion poster first, animated desktop slot after the phone stills", () => {
    const r = animatedPictureSources(
      media({ animation: anim("gif") }),
      undefined,
    );
    expect(r).not.toBeNull();
    expect(r?.leading.map((s) => [s.media, s.type, s.animated])).toEqual([
      [REDUCED_MOTION_QUERY, "image/webp", false],
      [REDUCED_MOTION_QUERY, "image/jpeg", false],
    ]);
    expect(r?.beforeDesktop).toEqual([
      { type: "image/gif", srcSet: anim("gif").src, animated: true },
    ]);
  });

  it("phone animation: its animated source is gated to the phone query and precedes the phone stills", () => {
    const r = animatedPictureSources(
      media(),
      media({ animation: anim("webp") }),
    );
    const kinds = r?.leading.map((s) => [s.media, s.type, s.animated]);
    expect(kinds).toEqual([
      [`${REDUCED_MOTION_QUERY} and ${PHONE_QUERY}`, "image/webp", false],
      [`${REDUCED_MOTION_QUERY} and ${PHONE_QUERY}`, "image/jpeg", false],
      [REDUCED_MOTION_QUERY, "image/webp", false],
      [REDUCED_MOTION_QUERY, "image/jpeg", false],
      [PHONE_QUERY, "image/webp", true],
    ]);
    expect(r?.beforeDesktop).toEqual([]);
  });

  it("a static phone picture beside an animated desktop one keeps the phone stills ahead of the animation", () => {
    // desktop animated + static phone: the caller renders phoneStills (slot 3) BEFORE beforeDesktop (slot 4)
    const r = animatedPictureSources(
      media({ animation: anim("gif") }),
      media(),
    );
    expect(r?.leading.every((s) => !s.animated)).toBe(true);
    expect(r?.beforeDesktop[0]?.animated).toBe(true);
  });
});
