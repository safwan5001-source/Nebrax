import { describe, expect, it } from "vitest";
import {
  AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX,
  customizerMediaPath,
  isCustomizerMediaFile,
  isCustomizerMediaId,
  toRenderableCustomizerMediaUrl,
} from "../customizer-media";
import { toRenderableMediaUrl } from "../mappers";

const UUID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("customizer media paths (V0 §7.8, AMEND-1/12)", () => {
  it("accepts a media id or a transformKey with the explicit width/format file", () => {
    expect(customizerMediaPath(UUID, "480w.webp")).toBe(
      `${AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX}${UUID}/480w.webp`,
    );
    expect(customizerMediaPath(KEY, "1920w.jpg")).toBe(
      `${AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX}${KEY}/1920w.jpg`,
    );
    expect(customizerMediaPath(UUID, "thumb-160.webp")).not.toBeNull();
    expect(customizerMediaPath(UUID, "thumb-320.jpg")).not.toBeNull();
  });

  it("rejects anything outside the contract instead of guessing", () => {
    expect(isCustomizerMediaId("../etc/passwd")).toBe(false);
    expect(isCustomizerMediaId(`${KEY}0`)).toBe(false);
    expect(isCustomizerMediaId(KEY.toUpperCase())).toBe(false);
    for (const file of [
      "original.jpg",
      "480w.png",
      "thumb-200.webp",
      "480.webp",
      "../480w.webp",
      "480w.webp?x=1",
    ]) {
      expect(isCustomizerMediaFile(file)).toBe(false);
      expect(customizerMediaPath(UUID, file)).toBeNull();
    }
  });

  it("never lets the raw host-resolved origin path reach a browser", () => {
    const raw = `/store/v1/media/customizer/${UUID}/768w.webp`;
    expect(toRenderableCustomizerMediaUrl(raw)).toBe(
      `${AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX}${UUID}/768w.webp`,
    );
    // absolute and with a query string
    expect(toRenderableMediaUrl(`https://api.example.com${raw}?v=1`)).toBe(
      `${AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX}${UUID}/768w.webp`,
    );
    // outside the contract → dropped, not forwarded raw
    expect(
      toRenderableMediaUrl(`/store/v1/media/customizer/${UUID}/original.jpg`),
    ).toBeNull();
    // unrelated product-media behaviour is untouched
    expect(toRenderableMediaUrl(`/store/v1/media/${UUID}`)).toBe(
      `/api/storefront/media/${UUID}`,
    );
  });
});
