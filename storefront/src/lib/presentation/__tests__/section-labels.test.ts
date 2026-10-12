import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";

/**
 * CUST-HV V10c (V0 §17.1) — a section's `label` is editor metadata: the storefront's normaliser never carries it, so it can reach no
 * component, heading or `aria-label`, even if a document (or an older public snapshot) still holds one.
 */
describe("section label — ignored by the storefront", () => {
  it("is dropped from every section", () => {
    const config = normalizePresentationConfig({
      version: 2,
      primaryColor: "#12372a",
      homepage: {
        sections: [
          { id: "hero", type: "hero", visible: true, label: "الرئيسي" },
          {
            id: "newArrivals",
            type: "newArrivals",
            visible: true,
            label: "وصل حديثاً",
            content: { title: "جديدنا" },
          },
        ],
      },
    });
    expect(config.homepage.sections.map((s) => s.id)).toEqual([
      "hero",
      "newArrivals",
    ]);
    expect(JSON.stringify(config.homepage.sections)).not.toContain("label");
    expect(config.homepage.sections[1].content).toEqual({ title: "جديدنا" });
  });
});
