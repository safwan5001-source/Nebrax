import { describe, expect, it } from "vitest";
import {
  shelfForm,
  shelfGridClass,
  shelfRailBreakpoints,
} from "../shelf-layout";

describe("shelf layout (CUST-HV V9d-2)", () => {
  it("absent layout keeps the theme's own form; an explicit one wins in either theme", () => {
    expect(shelfForm(undefined, false)).toBe("grid");
    expect(shelfForm(undefined, true)).toBe("rail");
    expect(shelfForm("rail", false)).toBe("rail");
    expect(shelfForm("grid", true)).toBe("grid");
  });

  it("absent columns is today's grid; 4 equals it; phones always show two", () => {
    expect(shelfGridClass(undefined)).toBe(
      "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
    );
    expect(shelfGridClass(4)).toBe(shelfGridClass(undefined));
    expect(shelfGridClass(3)).toBe("grid-cols-2 sm:grid-cols-3");
    expect(shelfGridClass(2)).toBe("grid-cols-2");
    for (const columns of [undefined, 2, 3, 4] as const) {
      expect(shelfGridClass(columns).split(" ")[0]).toBe("grid-cols-2");
    }
  });

  it("a rail follows the same count (absent = today's 3 / 5 per view)", () => {
    expect(shelfRailBreakpoints(undefined)).toEqual({
      640: { slidesPerView: 3, spaceBetween: 16 },
      1024: { slidesPerView: 5, spaceBetween: 20 },
    });
    expect(shelfRailBreakpoints(2)[1024].slidesPerView).toBe(2);
    expect(shelfRailBreakpoints(3)[1024].slidesPerView).toBe(3);
    expect(shelfRailBreakpoints(4)[1024].slidesPerView).toBe(4);
    expect(shelfRailBreakpoints(2)[640].slidesPerView).toBe(2);
    expect(shelfRailBreakpoints(4)[640].slidesPerView).toBe(3);
  });
});
