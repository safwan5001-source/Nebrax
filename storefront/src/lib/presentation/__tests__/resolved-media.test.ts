import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../config";
import {
  publishedFaviconSource,
  publishedLogoMedia,
  publishedMedia,
  readResolvedMedia,
} from "../resolved-media";

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const proxy = (id: string, file: string) =>
  `/api/storefront/media/customizer/${id}/${file}`;

const good = (id = ID) => ({
  width: 1600,
  height: 900,
  decorative: false,
  alt: { ar: " شعار ", en: null },
  sources: [
    {
      kind: "w",
      width: 480,
      height: 270,
      format: "webp",
      src: proxy(id, "480w.webp"),
    },
    {
      kind: "w",
      width: 480,
      height: 270,
      format: "jpg",
      src: proxy(id, "480w.jpg"),
    },
    {
      kind: "thumb",
      width: 320,
      height: 180,
      format: "webp",
      src: proxy(id, "thumb-320.webp"),
    },
    {
      kind: "thumb",
      width: 320,
      height: 180,
      format: "jpg",
      src: proxy(id, "thumb-320.jpg"),
    },
  ],
});

describe("readResolvedMedia (defensive read of presentation_media)", () => {
  it("keeps a well-formed entry and trims alt", () => {
    const map = readResolvedMedia({ "branding.logoMedia": good() });
    expect(map["branding.logoMedia"].alt).toEqual({ ar: "شعار", en: null });
    expect(map["branding.logoMedia"].sources).toHaveLength(4);
  });

  it("accepts a transformKey id as well as a media id", () => {
    const map = readResolvedMedia({ a: good(KEY) });
    expect(map.a.sources[0].src).toBe(proxy(KEY, "480w.webp"));
  });

  it("never lets anything but the same-origin proxy path through", () => {
    const hostile = (src: string) =>
      readResolvedMedia({
        a: {
          ...good(),
          sources: [{ kind: "w", width: 1, height: 1, format: "webp", src }],
        },
      });
    for (const src of [
      `/store/v1/media/customizer/${ID}/480w.webp`,
      `https://evil.example/api/storefront/media/customizer/${ID}/480w.webp`,
      `//evil.example${proxy(ID, "480w.webp")}`,
      proxy(`${ID}/..`, "480w.webp"),
      proxy(ID, "../480w.webp"),
      proxy(ID, "original.jpg"),
      proxy(ID, "480w.png"),
      `${proxy(ID, "480w.webp")}?x=1`,
      "javascript:alert(1)",
      "data:image/png;base64,AA==",
    ]) {
      expect(hostile(src), src).toEqual({});
    }
  });

  it("drops entries with bad dimensions, formats, kinds or shapes — and keeps the rest", () => {
    const map = readResolvedMedia({
      ok: good(),
      zero: { ...good(), width: 0 },
      fractional: { ...good(), height: 9.5 },
      noSources: { ...good(), sources: [] },
      notObject: "x",
      badKind: { ...good(), sources: [{ ...good().sources[0], kind: "hero" }] },
      badFormat: {
        ...good(),
        sources: [{ ...good().sources[0], format: "png" }],
      },
    });
    expect(Object.keys(map)).toEqual(["ok"]);
    expect(readResolvedMedia(null)).toEqual({});
    expect(readResolvedMedia([good()])).toEqual({});
  });

  it("an entry with one bad source keeps the good ones", () => {
    const map = readResolvedMedia({
      a: {
        ...good(),
        sources: [good().sources[0], { ...good().sources[1], src: "/x" }],
      },
    });
    expect(map.a.sources).toHaveLength(1);
  });
});

describe("what the shell asks for", () => {
  const presentation = {
    ...DEFAULT_PRESENTATION_CONFIG,
    branding: {
      ...DEFAULT_PRESENTATION_CONFIG.branding,
      logoMedia: { mediaId: ID },
      compactLogoMedia: {
        mediaId: KEY.replace(/^.{8}/, "11111111").padEnd(36, "0"),
      },
      faviconMedia: { mediaId: ID, fit: "contain" as const },
    },
  };
  const map = readResolvedMedia({
    "branding.logoMedia": good(),
    "branding.faviconMedia": good(),
  });

  it("a reference without a resolved entry yields nothing (callers fall back)", () => {
    expect(publishedMedia(presentation, {}, "branding.logoMedia")).toBeNull();
    expect(publishedMedia(null, map, "branding.logoMedia")).toBeNull();
  });

  it("compact logo applies only when it is resolved; otherwise the main logo", () => {
    expect(publishedLogoMedia(presentation, map, true)?.ref.mediaId).toBe(ID);
    expect(publishedLogoMedia(presentation, map, false)?.ref.mediaId).toBe(ID);
  });

  it("the favicon is the 320 px thumb, WebP first; the logo reference backs it up", () => {
    expect(publishedFaviconSource(presentation, map)).toBe(
      proxy(ID, "thumb-320.webp"),
    );

    const noFavicon = {
      ...presentation,
      branding: { ...presentation.branding, faviconMedia: undefined },
    };
    expect(publishedFaviconSource(noFavicon, map)).toBe(
      proxy(ID, "thumb-320.webp"),
    );
    expect(publishedFaviconSource(noFavicon, {})).toBeNull();
  });
});
