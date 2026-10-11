import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Canvas does not run the storefront's Tailwind theme: its `store-*` colour utilities are a hand-written list in
 * `store-preview.css`. A class the footer uses that this list lacks silently draws nothing (the brand-heavy CTA pill once did),
 * so every `store-*` colour utility `CanvasFooter` and `CanvasNav` emit must be defined there.
 */
describe("Canvas footer / nav colour utilities exist in store-preview.css (V7e-3)", () => {
  const css = readFileSync(resolve(__dirname, "../store-preview.css"), "utf8");
  for (const file of ["../CanvasFooter.tsx", "../CanvasNav.tsx"]) {
    it(file, () => {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      const used = new Set(source.match(/\b(?:bg|text|border)-store-[a-z-]+\b/g) ?? []);
      expect(used.size).toBeGreaterThan(0);
      for (const cls of used) {
        // `border-store-footer-border` etc. are defined as `.awj-store-preview .<class> {`
        expect(css, `${cls} is not defined in store-preview.css`).toContain(`.awj-store-preview .${cls} `);
      }
    });
  }
});
