import { describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "../presentation/config";
import {
  isoToLocalInput,
  localInputToIso,
  removeOfferIdFromSections,
  upsertOffer,
} from "../offers-management";
import { liveOffer } from "./offers-fixtures";

describe("offers-management helpers — CUST-H4-7b", () => {
  describe("datetime conversion (no invented timezone policy)", () => {
    it("empty / invalid input means 'no bound'", () => {
      expect(localInputToIso("")).toBeNull();
      expect(localInputToIso("   ")).toBeNull();
      expect(localInputToIso("not-a-date")).toBeNull();
      expect(isoToLocalInput(null)).toBe("");
      expect(isoToLocalInput("")).toBe("");
      expect(isoToLocalInput("garbage")).toBe("");
    });

    it("a local datetime-local value becomes the equivalent UTC ISO instant", () => {
      expect(localInputToIso("2026-12-01T09:30")).toBe(new Date(2026, 11, 1, 9, 30).toISOString());
      expect(localInputToIso("2026-12-01T09:30")).toMatch(/Z$/);
    });

    it("round-trips an API instant through the local input without drifting (minute precision)", () => {
      const iso = "2026-12-01T09:30:00.000Z";
      expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    });

    it("renders the local input in the YYYY-MM-DDTHH:mm shape", () => {
      expect(isoToLocalInput(new Date(2027, 0, 5, 7, 4).toISOString())).toBe("2027-01-05T07:04");
    });
  });

  describe("removeOfferIdFromSections — no dangling selection", () => {
    const sections = (): PresentationHomeSection[] => [
      { id: "hero", type: "hero", visible: true },
      { id: "a", type: "offers", visible: true, content: { offerIds: ["o1", "o2", "o3"] } },
      { id: "b", type: "offers", visible: false, content: { offerIds: ["o1"] } },
      { id: "c", type: "offers", visible: true, content: { offerIds: ["o2"] } },
      { id: "d", type: "offers", visible: true },
      { id: "f", type: "featured", visible: true, content: { productIds: ["o1"] } },
    ];

    it("removes the id from EVERY Offers instance (visible or hidden), keeping order", () => {
      const result = removeOfferIdFromSections(sections(), "o1");
      expect(result.changed).toBe(true);
      const byId = new Map(result.sections.map((s) => [s.id, s]));
      expect(byId.get("a")?.content).toEqual({ offerIds: ["o2", "o3"] });
      // The last reference leaves the section content empty (omitted), not `{offerIds: []}`.
      expect(byId.get("b")?.content).toBeUndefined();
    });

    it("leaves instances that do not reference the id untouched (same object identity)", () => {
      const input = sections();
      const result = removeOfferIdFromSections(input, "o1");
      const byId = new Map(result.sections.map((s) => [s.id, s]));
      expect(byId.get("c")).toBe(input[3]);
      expect(byId.get("d")).toBe(input[4]);
      expect(byId.get("hero")).toBe(input[0]);
    });

    it("never touches a non-offers section even if it holds the same string", () => {
      const result = removeOfferIdFromSections(sections(), "o1");
      expect(result.sections.find((s) => s.id === "f")?.content).toEqual({ productIds: ["o1"] });
    });

    it("reports no change (and returns the same array) when nothing referenced the id", () => {
      const input = sections();
      const result = removeOfferIdFromSections(input, "unknown");
      expect(result.changed).toBe(false);
      expect(result.sections).toBe(input);
    });
  });

  describe("upsertOffer", () => {
    it("replaces an existing row in place and appends a new one", () => {
      const rows = [liveOffer({ id: "a", position: 0 }), liveOffer({ id: "b", position: 1 })];
      const replaced = upsertOffer(rows, liveOffer({ id: "a", position: 0, discountPercent: 50 }));
      expect(replaced.map((r) => r.id)).toEqual(["a", "b"]);
      expect(replaced[0].discountPercent).toBe(50);
      expect(upsertOffer(rows, liveOffer({ id: "c", position: 2 })).map((r) => r.id)).toEqual(["a", "b", "c"]);
    });

    it("orders by position (stable for ties), like the server", () => {
      const rows = [liveOffer({ id: "a", position: 5 }), liveOffer({ id: "b", position: 7 })];
      expect(upsertOffer(rows, liveOffer({ id: "c", position: 1 })).map((r) => r.id)).toEqual(["c", "a", "b"]);
      expect(upsertOffer(rows, liveOffer({ id: "d", position: 5 })).map((r) => r.id)).toEqual(["a", "d", "b"]);
      // Moving an existing offer re-sorts it.
      expect(upsertOffer(rows, liveOffer({ id: "b", position: 0 })).map((r) => r.id)).toEqual(["b", "a"]);
    });
  });
});
