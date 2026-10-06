import { notFound } from "next/navigation";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import {
  type AnnouncementsDoc,
  normalizeAnnouncements,
} from "@/lib/presentation/announcements";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { PublishedFrame } from "../customizer-visual/frame";

/**
 * CUST-HV V3 — development-only visual fixture for the published announcement
 * bar. Mounts the real component against a normalised document. Production
 * requests 404. `?scenario=` rotate | ticker | surface | long · `?locale=`.
 */

type Scenario = "rotate" | "ticker" | "surface" | "long";

const TEXT = {
  ar: [
    "شحن مجاني لكل الطلبات فوق ٢٠٠ ريال",
    "توصيل في نفس اليوم داخل الدمام والخبر",
    "خصم ١٠٪ على أول طلب — لفترة محدودة",
  ],
  en: [
    "Free shipping on orders over SAR 200",
    "Same-day delivery in Dammam and Khobar",
    "10% off your first order — limited time",
  ],
} as const;

function docFor(scenario: Scenario, locale: "ar" | "en"): AnnouncementsDoc {
  const [a, b, c] = TEXT[locale];
  const long = `${a} · ${b} · ${c}`.slice(0, 120);
  const raw =
    scenario === "ticker"
      ? {
          enabled: true,
          items: [
            { id: "a", text: a, icon: "truck" },
            { id: "b", text: b, icon: "clock" },
            { id: "c", text: c, icon: "percent" },
          ],
          behaviour: { ticker: true, dismissible: true },
        }
      : scenario === "surface"
        ? {
            enabled: true,
            items: [
              {
                id: "a",
                text: a,
                icon: "gift",
                href: "/products",
                surface: { background: { hex: "#f5d36b" } },
              },
            ],
            behaviour: { sticky: true, dismissible: true },
          }
        : scenario === "long"
          ? {
              enabled: true,
              items: [{ id: "a", text: long, icon: "megaphone" }],
            }
          : {
              enabled: true,
              items: [
                { id: "a", text: a, icon: "truck" },
                { id: "b", text: b, icon: "clock" },
                { id: "c", text: c, icon: "percent", href: "/products" },
              ],
              behaviour: { rotate: true, dismissible: true },
            };
  const doc = normalizeAnnouncements(raw);
  if (!doc) throw new Error("announcement fixture failed to normalise");
  return doc;
}

export default async function AnnouncementVisualPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; locale?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "ar";
  const scenario: Scenario =
    params.scenario === "ticker" ||
    params.scenario === "surface" ||
    params.scenario === "long"
      ? params.scenario
      : "rotate";

  return (
    <PublishedFrame locale={locale} messages={locale === "ar" ? ar : en}>
      <div
        dir={locale === "ar" ? "rtl" : "ltr"}
        lang={locale}
        data-scenario={scenario}
        className="min-h-dvh bg-store-background text-store-foreground"
      >
        <AnnouncementBar
          doc={docFor(scenario, locale)}
          basePath="/dev/announcement-visual"
          serverNow={Date.now()}
        />
        <header className="border-b border-store-border bg-store-surface p-4 text-lg font-semibold">
          Al Noor
        </header>
        <main className="space-y-4 p-4">
          {Array.from({ length: 24 }, (_, i) => (
            <p key={i} className="text-store-muted-foreground">
              {locale === "ar"
                ? "فقرة نموذجية لاختبار التثبيت والتمرير."
                : "Sample paragraph to exercise sticky and scroll."}
            </p>
          ))}
        </main>
      </div>
    </PublishedFrame>
  );
}
