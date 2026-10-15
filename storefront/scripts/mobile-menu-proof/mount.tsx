// Production MobileMenu + RegionPreferences; synthetic tenant data, no backend.

import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { StoreProvider } from "@/contexts/StoreContext";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "ar" ? "ar" : "en";
const tenant = params.get("tenant") === "b" ? "b" : "a";
const long = params.get("long") === "1";
const basePath = tenant === "a" ? `/sa/${locale}` : `/us/${locale}`;
const label = locale === "ar" ? "قسم المتجر" : "Store category";
const nested = {
  id: "shared-id",
  name: `${label} ${tenant.toUpperCase()}`,
  permalink: `tenant-${tenant}`,
  children: [
    {
      id: "child",
      name: locale === "ar" ? "مجموعة فرعية" : "Subcategory",
      permalink: `tenant-${tenant}/child`,
      children: [
        {
          id: "leaf",
          name: locale === "ar" ? "منتجات المجموعة" : "Collection products",
          permalink: `tenant-${tenant}/child/leaf`,
          children: [],
        },
      ],
    },
  ],
};
const categories = [
  nested,
  ...Array.from({ length: long ? 45 : 3 }, (_, index) => ({
    id: `cat-${index}`,
    name: `${label} ${index + 1}`,
    permalink: `tenant-${tenant}-${index}`,
    children: [],
  })),
];
createRoot(document.getElementById("mount")!).render(
  <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}>
    <StoreProvider
      initialCountry={tenant === "a" ? "sa" : "us"}
      initialLocale={locale}
      initialMarkets={
        [
          {
            id: tenant,
            currency: tenant === "a" ? "SAR" : "USD",
            default_locale: locale,
            supported_locales: ["ar", "en"],
            countries: [
              {
                id: tenant,
                iso: tenant === "a" ? "SA" : "US",
                name: tenant === "a" ? "Saudi Arabia" : "United States",
              },
            ],
          },
        ] as never
      }
    >
      <MobileMenu
        rootCategories={categories as never}
        basePath={basePath}
        wholesaleEnabled={tenant === "a"}
        extraLinks={
          [
            {
              id: "same-link-id",
              label:
                locale === "ar"
                  ? `عن المتجر ${tenant.toUpperCase()}`
                  : `About store ${tenant.toUpperCase()}`,
              href: `${basePath}/about-${tenant}`,
              icon: "store",
              badge: { text: locale === "ar" ? "جديد" : "New", tone: "brand" },
            },
            {
              id: "dropdown",
              label: locale === "ar" ? "روابط إضافية" : "More links",
              href: `${basePath}/more`,
              dropdown: true,
              children: [
                {
                  id: "external",
                  label: "External",
                  href: `https://example.com/${tenant}`,
                  newTab: true,
                },
              ],
            },
          ] as never
        }
      />
    </StoreProvider>
  </NextIntlClientProvider>,
);
