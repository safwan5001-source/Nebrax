import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AWJ_FACET_VISUAL_MEDIA_PROXY_PATH_PREFIX,
  FACET_VISUAL_MEDIA_FILES,
  facetVisualMediaPath,
  toRenderableFacetVisualMediaUrl,
} from "../facet-visual-media";
import { toRenderableMediaUrl } from "../mappers";

const VISUAL = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const MEDIA = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const ORIGIN = `/store/v1/media/facet-visuals/${VISUAL}/${MEDIA}`;
const PROXY = `${AWJ_FACET_VISUAL_MEDIA_PROXY_PATH_PREFIX}${VISUAL}/${MEDIA}`;

describe("facet visual media URLs (AWJ-VD-H1 VD-1c §3.8-c)", () => {
  it("keeps the file list identical to the PHP authority", () => {
    const php = readFileSync(
      resolve(
        process.cwd(),
        "..",
        "app/Services/Commerce/StorefrontFacetVisualProjector.php",
      ),
      "utf8",
    );
    const block = php.match(/public const FILES = \[([\s\S]*?)\];/);
    expect(block).not.toBeNull();
    const files = [...(block?.[1] ?? "").matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(files).toEqual([...FACET_VISUAL_MEDIA_FILES]);
  });

  it("rewrites every allowed file of a valid origin path to the proxy path", () => {
    for (const file of FACET_VISUAL_MEDIA_FILES) {
      expect(toRenderableFacetVisualMediaUrl(`${ORIGIN}/${file}`)).toBe(
        `${PROXY}/${file}`,
      );
      expect(toRenderableMediaUrl(`${ORIGIN}/${file}`)).toBe(
        `${PROXY}/${file}`,
      );
    }
  });

  it("returns null — never the raw URL — for anything outside the contract", () => {
    for (const url of [
      `${ORIGIN}/original.jpg`,
      `${ORIGIN}/photo.jpg`,
      `${ORIGIN}/1200w.webp`,
      `${ORIGIN}/320w.webp`,
      `${ORIGIN}/480w.png`,
      `${ORIGIN}/480w.WEBP`,
      `/store/v1/media/facet-visuals/not-a-uuid/${MEDIA}/480w.webp`,
      `/store/v1/media/facet-visuals/${VISUAL.toUpperCase()}/${MEDIA}/480w.webp`,
      `/store/v1/media/facet-visuals/${VISUAL}/480w.webp`,
      `${ORIGIN}/480w.webp/extra`,
      `${ORIGIN}/..%2F..%2Foriginal.jpg`,
      `${ORIGIN}/%2e%2e`,
      `/store/v1/media/facet-visuals/${VISUAL}%2F${MEDIA}/480w.webp`,
      `/store/v1/media/facet-visuals/${VISUAL}/../${MEDIA}/480w.webp`,
      `${ORIGIN}/480w.webp?x=1`,
      `${ORIGIN}/480w.webp#x`,
      `https://evil.example/store/v1/media/facet-visuals/${VISUAL}/${MEDIA}/480w.webp`,
      `//evil.example/store/v1/media/facet-visuals/${VISUAL}/${MEDIA}/480w.webp`,
      "/store/v1/media/facet-visuals",
      "/store/v1/media/facet-visuals/",
    ]) {
      expect(toRenderableFacetVisualMediaUrl(url), url).toBeNull();
      expect(toRenderableMediaUrl(url), url).toBeNull();
    }
  });

  it("is checked before the generic media pattern", () => {
    // The generic `/store/v1/media/{id}` branch must never see these paths.
    expect(toRenderableMediaUrl(`${ORIGIN}/480w.webp`)).not.toContain(
      "/store/v1/",
    );
    expect(toRenderableMediaUrl("/store/v1/media/facet-visuals")).toBeNull();
    // Unrelated media keeps its existing rewrite.
    expect(toRenderableMediaUrl(`/store/v1/media/${MEDIA}`)).toBe(
      `/api/storefront/media/${MEDIA}`,
    );
  });

  it("builds a proxy path only from valid segments", () => {
    expect(facetVisualMediaPath(VISUAL, MEDIA, "thumb-160.webp")).toBe(
      `${PROXY}/thumb-160.webp`,
    );
    expect(facetVisualMediaPath(VISUAL, MEDIA, "original.jpg")).toBeNull();
    expect(facetVisualMediaPath("x", MEDIA, "480w.webp")).toBeNull();
    expect(facetVisualMediaPath(VISUAL, "../x", "480w.webp")).toBeNull();
  });
});
