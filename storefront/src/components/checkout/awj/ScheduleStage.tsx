"use client";

import { CalendarDays } from "lucide-react";
import type { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { StageShell } from "@/components/checkout/awj/StageShell";
import type { ScheduleDraft } from "@/components/checkout/awj/types";
import { Button } from "@/components/ui/button";
import type { StorefrontDeliverySchedule } from "@/lib/commerce/checkout-gifting";
import { cn } from "@/lib/utils";
import {
  formatDeliveryDay,
  formatDeliveryWindow,
} from "@/lib/utils/delivery-day";

export type ScheduleLoad =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; schedule: StorefrontDeliverySchedule };

/**
 * Optional stage — the delivery (or pickup) date and time window (ADR-19).
 *
 * Only windows the server says can be chosen *right now* are listed; lead time,
 * the same-day cut-off, blocked dates, weekdays and the destination zone are
 * already applied. The browser never decides what is available: "today" and
 * "tomorrow" are worded from the channel's own timezone, and the choice is
 * re-validated when the order is placed (capacity is only enforced then — the
 * note says so, nothing is reserved here).
 */
export function ScheduleStage({
  load,
  draft,
  onChange,
  onRetry,
  selectionInvalid,
  method,
  t,
}: {
  load: ScheduleLoad;
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  onRetry: () => void;
  /** The stored choice is no longer selectable (server said `valid: false`). */
  selectionInvalid: boolean;
  method: "delivery" | "pickup";
  t: ReturnType<typeof useTranslations>;
}) {
  const locale = useLocale();
  const pickup = method === "pickup";

  return (
    <StageShell
      id="awj-checkout-schedule"
      title={pickup ? t("schedule.headingPickup") : t("schedule.heading")}
      description={
        pickup ? t("schedule.descriptionPickup") : t("schedule.description")
      }
    >
      {load.state === "loading" && (
        <p role="status" className="text-sm text-store-muted-foreground">
          {t("schedule.loading")}
        </p>
      )}

      {load.state === "error" && (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-store-destructive">
            {t("schedule.loadFailed")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("schedule.retry")}
          </Button>
        </div>
      )}

      {load.state === "ready" && (
        <ScheduleOptions
          schedule={load.schedule}
          draft={draft}
          onChange={onChange}
          selectionInvalid={selectionInvalid}
          locale={locale}
          t={t}
        />
      )}
    </StageShell>
  );
}

function ScheduleOptions({
  schedule,
  draft,
  onChange,
  selectionInvalid,
  locale,
  t,
}: {
  schedule: StorefrontDeliverySchedule;
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  selectionInvalid: boolean;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (schedule.dates.length === 0) {
    return (
      <p
        role={schedule.required ? "alert" : "note"}
        className="text-sm text-store-muted-foreground"
      >
        {schedule.required
          ? t("schedule.noWindows")
          : t("schedule.noWindowsOptional")}
      </p>
    );
  }

  const timezone = schedule.timezone;
  const dayLabel = (date: string) =>
    (timezone
      ? formatDeliveryDay({
          date,
          timezone,
          locale,
          todayLabel: t("schedule.today"),
          tomorrowLabel: t("schedule.tomorrow"),
        })
      : null) ??
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));

  const selectedDay = schedule.dates.find((entry) => entry.date === draft.date);

  return (
    <div className="space-y-5">
      {selectionInvalid && (
        <p
          role="alert"
          className="rounded-store border border-store-warning/50 bg-store-warning/10 px-3 py-2 text-sm text-store-foreground"
        >
          {t("schedule.invalidSelection")}
        </p>
      )}
      {schedule.required && (
        <p className="text-xs font-medium text-store-muted-foreground">
          {t("schedule.requiredNote")}
        </p>
      )}

      <fieldset>
        <legend className="mb-2 flex items-center gap-1.5 text-sm font-bold text-store-foreground">
          <CalendarDays className="size-4" aria-hidden="true" />
          {t("schedule.dateLabel")}
        </legend>
        <ul className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
          {schedule.dates.map((entry) => {
            const on = entry.date === draft.date;
            return (
              <li key={entry.date} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={on}
                  data-schedule-date={entry.date}
                  onClick={() =>
                    onChange(on ? draft : { date: entry.date, slotId: null })
                  }
                  className={cn(
                    "min-h-11 rounded-store border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary",
                    on
                      ? "border-store-primary bg-store-primary text-store-primary-foreground"
                      : "border-store-border bg-store-surface text-store-foreground hover:border-store-primary",
                  )}
                >
                  {dayLabel(entry.date)}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {selectedDay && (
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-store-foreground">
            {t("schedule.slotLabel")}
          </legend>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {selectedDay.slots.map((slot) => {
              const on = slot.id === draft.slotId;
              const window = formatDeliveryWindow(
                slot.startTime,
                slot.endTime,
                locale,
              );
              const label =
                locale.toLowerCase().startsWith("en") && slot.labelEn
                  ? slot.labelEn
                  : slot.label;
              return (
                <li key={slot.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    data-schedule-slot={slot.id}
                    onClick={() =>
                      onChange({ date: selectedDay.date, slotId: slot.id })
                    }
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start rounded-store border px-4 py-2 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary",
                      on
                        ? "border-store-primary bg-store-primary-soft"
                        : "border-store-border bg-store-surface hover:border-store-primary",
                    )}
                  >
                    <span className="text-sm font-bold text-store-foreground">
                      {label}
                    </span>
                    {window && (
                      <bdi className="text-xs text-store-muted-foreground">
                        {window}
                      </bdi>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {!schedule.required && (draft.date !== null || draft.slotId !== null) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ date: null, slotId: null })}
        >
          {t("schedule.noPreference")}
        </Button>
      )}

      <p className="text-xs leading-relaxed text-store-muted-foreground">
        {t("schedule.requestedNote")}
      </p>
    </div>
  );
}
