import { getTranslations } from "next-intl/server";
import { fetchEarliestDelivery } from "@/lib/commerce/data-sections";
import type { DeliveryPromiseContent } from "@/lib/presentation/section-content";
import {
  formatDeliveryDay,
  formatDeliveryWindow,
} from "@/lib/utils/delivery-day";

/**
 * FLOWERS-H9b / ADR-21 — the published "deliveryPromise" band.
 *
 * Optional merchant text only; the date and window are the *live* earliest
 * selectable slot from the public delivery schedule (clock, cut-off, blocked
 * dates and capacity already applied by the backend). If scheduling is off,
 * nothing is selectable, or the read fails, the band is omitted — the store
 * never states a delivery promise it cannot back.
 */
export async function DeliveryPromiseBand({
  content,
  locale,
  headingId,
}: {
  content: DeliveryPromiseContent;
  locale: string;
  headingId: string;
}) {
  const earliest = await fetchEarliestDelivery().catch((error) => {
    console.error(
      "DeliveryPromiseBand: failed to load delivery schedule",
      error,
    );
    return null;
  });
  if (!earliest) return null;

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const day = formatDeliveryDay({
    date: earliest.date,
    timezone: earliest.timezone,
    locale,
    todayLabel: t("deliveryToday"),
    tomorrowLabel: t("deliveryTomorrow"),
  });
  const window = formatDeliveryWindow(
    earliest.startTime,
    earliest.endTime,
    locale,
  );
  if (!day || !window) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-store border border-store-border bg-store-surface px-4 py-4 md:px-6 md:py-5"
    >
      <h2
        id={headingId}
        className="text-base font-extrabold text-store-foreground md:text-lg"
      >
        {content.title || t("earliestDelivery")}
      </h2>
      <p className="mt-1 text-sm font-bold text-store-primary md:text-base">
        {t("deliveryAt", { day, window })}
      </p>
      {content.body ? (
        <p className="mt-1 text-xs text-store-muted-foreground md:text-sm">
          {content.body}
        </p>
      ) : null}
    </section>
  );
}
