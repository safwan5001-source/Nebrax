/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SOCIAL_MARKS,
  OfficialSocialMark,
  officialSocialMarkSrc,
} from "../OfficialSocialMark";

describe("official social mark registry", () => {
  it("maps each supported network to exactly one asset and fails closed", () => {
    const srcs = Object.values(OFFICIAL_SOCIAL_MARKS).map((mark) => mark.src);
    expect(new Set(srcs).size).toBe(8);
    expect(officialSocialMarkSrc("not-a-network")).toBeNull();
    const view = render(<OfficialSocialMark network="tiktok" />);
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/social/tiktok.png",
    );
    expect(render(<OfficialSocialMark network="threads" />).container.innerHTML).toBe(
      "",
    );
  });
});
