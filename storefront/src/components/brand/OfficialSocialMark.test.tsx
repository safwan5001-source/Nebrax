import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SOCIAL_MARKS,
  OfficialSocialMark,
  officialSocialMarkSrc,
} from "./OfficialSocialMark";

const STORE_ASSETS = resolve(__dirname, "../../../public/brand/social");
const WEB_ASSETS = resolve(__dirname, "../../../../web/public/brand/social");

describe("official social mark registry", () => {
  it("maps each supported network to exactly one known asset and fails closed", () => {
    const srcs = Object.values(OFFICIAL_SOCIAL_MARKS).map((mark) => mark.src);
    expect(new Set(srcs).size).toBe(srcs.length);
    expect(Object.keys(OFFICIAL_SOCIAL_MARKS).sort()).toEqual(
      [
        "facebook",
        "instagram",
        "linkedin",
        "snapchat",
        "tiktok",
        "whatsapp",
        "x",
        "youtube",
      ].sort(),
    );
    for (const [network, mark] of Object.entries(OFFICIAL_SOCIAL_MARKS)) {
      expect(officialSocialMarkSrc(network)).toBe(mark.src);
      expect(mark.width).toBeGreaterThan(0);
      expect(mark.height).toBeGreaterThan(0);
    }
    expect(officialSocialMarkSrc("myspace")).toBeNull();
    expect(officialSocialMarkSrc("")).toBeNull();
    expect(
      render(<OfficialSocialMark network="myspace" />).container.innerHTML,
    ).toBe("");
  });

  it("keeps storefront and web copies byte-identical", () => {
    const names = readdirSync(STORE_ASSETS).sort();
    expect(names).toEqual(readdirSync(WEB_ASSETS).sort());
    expect(names.length).toBe(Object.keys(OFFICIAL_SOCIAL_MARKS).length);
    for (const name of names) {
      expect(readFileSync(join(STORE_ASSETS, name))).toEqual(
        readFileSync(join(WEB_ASSETS, name)),
      );
    }
  });
});
