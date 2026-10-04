import { describe, expect, it } from "vitest";
import {
  hasListingContext,
  listingContextParams,
  parseListingContext,
} from "../listing-context";

const UUID = "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d6e";

describe("listing-context (FLOWERS-H9b)", () => {
  it("is empty for a plain listing URL", () => {
    const context = parseListingContext({ q: "rose", sort: "name" });
    expect(hasListingContext(context)).toBe(false);
    expect(listingContextParams(context)).toEqual({});
  });

  it("reads collection, facets, brand and deliver today", () => {
    const context = parseListingContext({
      collection: "best-sellers",
      "facet[occasion]": "mothers-day,eid",
      "facet[recipient]": "mom",
      brand_id: UUID,
      deliver_today: "true",
    });
    expect(hasListingContext(context)).toBe(true);
    expect(listingContextParams(context)).toEqual({
      collection: "best-sellers",
      brand_id: UUID,
      deliver_today: true,
      "facet[occasion]": "mothers-day,eid",
      "facet[recipient]": "mom",
    });
  });

  it("accepts 1 as well as true, and treats anything else as off", () => {
    expect(parseListingContext({ deliver_today: "1" }).deliverToday).toBe(true);
    expect(parseListingContext({ deliver_today: "TRUE" }).deliverToday).toBe(
      true,
    );
    expect(parseListingContext({ deliver_today: "false" }).deliverToday).toBe(
      false,
    );
    expect(parseListingContext({ deliver_today: "yes" }).deliverToday).toBe(
      false,
    );
  });

  it("drops malformed tokens instead of forwarding them upstream", () => {
    const context = parseListingContext({
      collection: "Bad Slug!",
      brand_id: "not-a-uuid",
      "facet[Bad Key]": "x",
      "facet[occasion]": "ok,bad slug",
      "facet[recipient]": "",
    });
    expect(hasListingContext(context)).toBe(false);
  });

  it("takes the first value of a repeated param and bounds the number of facets", () => {
    expect(parseListingContext({ collection: ["a", "b"] }).collection).toBe(
      "a",
    );
    const many: Record<string, string> = {};
    for (let i = 0; i < 20; i++) many[`facet[k${i}]`] = "v";
    expect(Object.keys(parseListingContext(many).facets)).toHaveLength(8);
  });

  it("bounds the slugs per facet", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `v${i}`).join(",");
    expect(parseListingContext({ "facet[occasion]": tooMany }).facets).toEqual(
      {},
    );
  });
});
