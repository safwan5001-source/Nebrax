// CUST-HV V7d-3 — proof entry: mounts the PRODUCTION `HeaderNavLinks` (desktop) and `MobileNavItem` (mobile accordion) into the
// placeholders of the statically rendered header, with the real AR / EN messages, so the browser proof drives the real components.
import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { HeaderNavLinks } from "@/components/layout/HeaderNavLinks";
import { MobileNavItem } from "@/components/layout/MobileNavItem";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const locale = document.documentElement.lang === "ar" ? "ar" : "en";
const messages = locale === "ar" ? ar : en;

for (const host of document.querySelectorAll<HTMLElement>("[data-nav-mount]")) {
  const items = JSON.parse(host.dataset.items ?? "[]");
  createRoot(host).render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <HeaderNavLinks items={items} />
    </NextIntlClientProvider>,
  );
}
for (const host of document.querySelectorAll<HTMLElement>("[data-mobile-mount]")) {
  const items = JSON.parse(host.dataset.items ?? "[]");
  createRoot(host).render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <nav className="flex flex-col gap-1 px-4 pt-2" aria-label="mobile">
        {items.map((item: { id: string }) => (
          <MobileNavItem
            key={item.id}
            item={item as never}
            linkClass="text-left text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg px-3 py-2.5 text-base transition-colors"
            onNavigate={() => undefined}
          />
        ))}
      </nav>
    </NextIntlClientProvider>,
  );
}
