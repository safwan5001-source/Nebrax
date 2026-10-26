import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async ({ locale, namespace }: { locale: string; namespace: string }) => {
      const bundle = (locale === "ar" ? ar : en) as unknown as Record<
        string,
        Record<string, string>
      >;
      return (key: string) => bundle[namespace][key];
    },
  ),
}));

vi.mock("@/lib/metadata/alternates", () => ({
  buildHreflangLanguages: vi.fn(async () => undefined),
  buildLocalizedAlternates: vi.fn(async () => undefined),
  translationFingerprint: vi.fn(() => ""),
}));

const mocks = vi.hoisted(() => ({ fetchStorefrontConfig: vi.fn() }));
vi.mock("@/lib/commerce/storefront", () => ({
  fetchStorefrontConfig: mocks.fetchStorefrontConfig,
  fetchStorefrontName: vi.fn(async () => {
    const c = await mocks.fetchStorefrontConfig();
    return c.name;
  }),
}));

import { generateCategoriesMetadata } from "../categories";
import { generateProductsMetadata } from "../products";

describe("page-specific titles are localized (META-BRAND-1)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://store.example.test");
  });

  it.each([
    ["ar", ar],
    ["en", en],
  ])("products listing (%s) uses the message catalog, not English literals", async (locale, bundle) => {
    const m = await generateProductsMetadata({ country: "sa", locale });
    expect(m.title).toBe(bundle.products.allProducts);
    expect(m.description).toBe(bundle.products.browseCollection);
    expect(m.openGraph?.title).toBe(bundle.products.allProducts);
  });

  it.each([
    ["ar", ar],
    ["en", en],
  ])("categories listing (%s) uses the message catalog", async (locale, bundle) => {
    const m = await generateCategoriesMetadata({ country: "sa", locale });
    expect(m.title).toBe(bundle.products.categories);
  });
});

describe("no legacy Spree branding in public storefront source", () => {
  const root = path.resolve(__dirname, "../../..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "dev") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
        files.push(full);
      }
    }
  };
  walk(root);

  it("ships no 'Spree Store' fallback literal or Spree description default", () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8")
        // Prose mentions in comments are fine; only string literals matter.
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      return /["'`]Spree Store["'`]|powered by Spree/i.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("does not read the deployment-wide name for page metadata", () => {
    const src = readFileSync(path.join(root, "lib/metadata/store.ts"), "utf8");
    expect(src).not.toMatch(
      /getStoreName|getStoreSeoTitle|NEXT_PUBLIC_STORE_NAME/,
    );
  });
});
