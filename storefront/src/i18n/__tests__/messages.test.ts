import { describe, expect, it } from "vitest";
import ar from "../../../messages/ar.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import pl from "../../../messages/pl.json";

const BUNDLES = { ar, de, en, es, fr, pl };

describe("message bundles", () => {
  it("presents the merchant name without wrapping it in generic words", () => {
    // Every bundle used to decorate the authoritative store name — "متجر
    // {storeName}" in Arabic, "{storeName} Storefront" elsewhere — which
    // duplicated the word for a store already called "متجر …" and appended a
    // platform noun to every other merchant's name.
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      expect(bundle.home.welcome, locale).toBe("{storeName}");
    }
  });
});
