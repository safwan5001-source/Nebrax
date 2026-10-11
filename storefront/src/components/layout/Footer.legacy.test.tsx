import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/spree", () => ({ isWholesaleEnabled: () => true }));

import { Footer } from "./Footer";

const base = {
  basePath: "/sa/en",
  locale: "en" as Locale,
  categoryLinks: null,
  storeName: "Shop",
};
const full = {
  tagline: "A tagline",
  copyright: "© me",
  showSbc: true,
  sbcSealToken: "tok",
  licenseNumber: "L-1",
  contact: {
    phone: "+966500000000",
    email: "a@b.sa",
    address: "Riyadh",
    hours: "9-5",
  },
  socialLinks: [
    { id: "i", network: "instagram", href: "https://instagram.com/x" },
  ],
  whatsappHref: "https://wa.me/966500000000",
  appLinks: [
    {
      id: "a",
      store: "apple" as const,
      label: "App Store",
      href: "https://apps.apple.com/app/id1",
    },
  ],
  businessIdentity: { legal_name: "Co", cr_number: "123", vat_number: "300" },
  showLogo: false,
};

async function markup(props: object) {
  const el = await Footer({ ...base, ...props });
  return renderToStaticMarkup(el).replace(/\d{4}/g, "YYYY");
}

describe("Footer — backward compatibility (V7e-2)", () => {
  it("with no layout, groups or design the markup is the original, byte for byte", async () => {
    const expected = readFileSync(
      resolve(__dirname, "__fixtures__/footer-legacy.html"),
      "utf8",
    );
    const actual = [await markup({}), await markup(full)].join("\n=====\n");
    expect(actual).toBe(expected);
  });

  it("explicit absent keys change nothing", async () => {
    expect(
      await markup({
        ...full,
        layout: undefined,
        groups: null,
        design: undefined,
      }),
    ).toBe(await markup(full));
  });
});
