"use client";

/**
 * CUST-H1-5 — Schedule/Reschedule/Cancel-schedule dialogs.
 *
 * Split from `ExperienceBuilder.tsx` (already 1900+ lines) — presentational
 * only, mirroring `PublishConfirmDialog`'s centered-modal pattern exactly
 * (same viewport treatment on every breakpoint, same `role="dialog"`
 * conventions) so scheduling reads as the same product, not a bolted-on
 * flow. All state/network orchestration stays in `ExperienceBuilder`.
 */

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/formatting";
import {
  safeTimeZone,
  suggestedInitialWallTime,
  timeZoneDisplayLabel,
  utcIsoToZonedWallTime,
  zonedWallTimeToUtcIso,
} from "@/lib/timezone";
import type { PresentationVersionSummary } from "@/modules/commerce-workspace/presentation-versions";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "./messages";

export type ScheduleDialogMode = "schedule" | "reschedule";

export function ScheduleConfirmDialog({
  locale,
  mode,
  target,
  storeName,
  timezone,
  replacingVersion,
  busy,
  onCancel,
  onConfirm,
}: {
  locale: CustomizerLocale;
  mode: ScheduleDialogMode;
  target: PresentationVersionSummary;
  storeName: string | null;
  timezone: string;
  /** CUST-H1-ARCH-1 §10 — another Version currently scheduled for this same Storefront, about to be replaced. `schedule` mode only; always `null` for `reschedule` (a version can only replace *another* version, never itself). */
  replacingVersion: PresentationVersionSummary | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (scheduledForIso: string) => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const zone = safeTimeZone(timezone);
  const [seed] = useState(() =>
    mode === "reschedule" && target.scheduledFor
      ? (utcIsoToZonedWallTime(target.scheduledFor, zone) ?? suggestedInitialWallTime(zone))
      : suggestedInitialWallTime(zone),
  );
  const [dateValue, setDateValue] = useState(seed.date);
  const [timeValue, setTimeValue] = useState(seed.time);
  const todayValue = useMemo(() => utcIsoToZonedWallTime(new Date().toISOString(), zone)?.date, [zone]);

  const scheduledForIso = zonedWallTimeToUtcIso(dateValue, timeValue, zone);
  const isPast = scheduledForIso !== null && new Date(scheduledForIso).getTime() <= Date.now();
  const canSubmit = scheduledForIso !== null && !isPast && !busy;

  const titlePrefix =
    mode === "reschedule"
      ? t("versionScheduleDialogTitleReschedule")
      : t("versionScheduleDialogTitleSchedule");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-confirm-title"
        data-schedule-confirm-dialog=""
        className="flex max-h-[85dvh] w-full max-w-sm flex-col overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-2xl"
      >
        <h2 id="schedule-confirm-title" className="text-sm font-semibold text-text">
          {titlePrefix}
          <bdi>{target.name}</bdi>
          {t("versionScheduleDialogTitleSuffix")}
        </h2>
        <p className="mt-2 text-xs text-muted">
          {t("versionScheduleStorefrontLabel")}: <bdi>{storeName ?? t("currentPage")}</bdi>
        </p>

        {replacingVersion ? (
          <p
            data-schedule-replace-warning=""
            role="alert"
            className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs leading-5 text-warning"
          >
            {t("versionScheduleReplaceWarningPrefix")}
            <bdi>{replacingVersion.name}</bdi>
            {t("versionScheduleReplaceWarningSuffix")}
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-text">
            <span>{t("versionScheduleDateLabel")}</span>
            <input
              type="date"
              dir="ltr"
              data-schedule-date=""
              value={dateValue}
              min={todayValue}
              onChange={(event) => setDateValue(event.target.value)}
              // شبكة عمودين تضغط على عرض متاح ضيّق جداً على 390/768px — حقول
              // `date`/`time` الأصلية لها عرض أدنى مفروض من المتصفح لا يتقلّص
              // تلقائياً مع Grid؛ `min-w-0` على `<label>` + `w-full` هنا يسمحان
              // لهما بالتقلّص فعلياً بدل دفع الحوار/الصفحة لفيضان أفقي (نفس
              // إصلاح فائض التبويب 768px في مُنتقي النسخة، CUST-H1-2 §review).
              className="h-9 w-full min-w-0 rounded border border-border bg-surface px-2 text-sm text-text outline-none focus:border-primary"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-text">
            <span>{t("versionScheduleTimeLabel")}</span>
            <input
              type="time"
              dir="ltr"
              data-schedule-time=""
              value={timeValue}
              onChange={(event) => setTimeValue(event.target.value)}
              className="h-9 w-full min-w-0 rounded border border-border bg-surface px-2 text-sm text-text outline-none focus:border-primary"
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          {t("versionScheduleTimezoneNote")} {timeZoneDisplayLabel(zone, locale)}
        </p>

        {scheduledForIso && !isPast ? (
          <p data-schedule-preview="" className="mt-3 text-xs leading-5 text-text">
            {t("versionSchedulePreviewPrefix")}
            <bdi>{target.name}</bdi>
            {t("versionSchedulePreviewMiddle")}{" "}
            <bdi>{formatDateTime(scheduledForIso, locale, { timeZone: zone })}</bdi>
            {" "}
            {timeZoneDisplayLabel(zone, locale)}
          </p>
        ) : null}

        {isPast ? (
          <p role="alert" className="mt-3 text-xs font-medium text-negative">
            {t("versionSchedulePastRejected")}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            data-schedule-confirm-cancel=""
            disabled={busy}
            onClick={onCancel}
            className="h-9 rounded-md border border-border px-3 text-xs font-medium text-text hover:bg-primary-soft disabled:opacity-50"
          >
            {t("versionScheduleCancel")}
          </button>
          <button
            type="button"
            data-schedule-confirm-submit=""
            disabled={!canSubmit}
            onClick={() => {
              if (scheduledForIso) onConfirm(scheduledForIso);
            }}
            className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy
              ? t("versionScheduling")
              : mode === "reschedule"
                ? t("versionRescheduleSubmit")
                : t("versionScheduleSubmit")}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * CUST-H1-5 — cancel is a lifecycle action, not a generic delete. Names the
 * version, states plainly it returns to Draft (not deleted) and that the
 * live storefront is unaffected — never a bare "are you sure?".
 */
export function CancelScheduleConfirmDialog({
  locale,
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  locale: CustomizerLocale;
  target: PresentationVersionSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-schedule-confirm-title"
        data-cancel-schedule-confirm-dialog=""
        className="flex max-h-[85dvh] w-full max-w-sm flex-col overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-2xl"
      >
        <h2 id="cancel-schedule-confirm-title" className="text-sm font-semibold text-text">
          {t("versionCancelScheduleConfirmTitlePrefix")}
          <bdi>{target.name}</bdi>
          {t("versionCancelScheduleConfirmTitleSuffix")}
        </h2>
        <p className="mt-3 text-xs leading-5 text-text">{t("versionCancelScheduleConfirmBody")}</p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            data-cancel-schedule-confirm-keep=""
            disabled={busy}
            onClick={onCancel}
            className="h-9 rounded-md border border-border px-3 text-xs font-medium text-text hover:bg-primary-soft disabled:opacity-50"
          >
            {t("versionCancelScheduleKeep")}
          </button>
          <button
            type="button"
            data-cancel-schedule-confirm-submit=""
            disabled={busy}
            onClick={onConfirm}
            className="h-9 rounded-md bg-negative px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? t("versionCancelScheduling") : t("versionCancelScheduleSubmit")}
          </button>
        </div>
      </section>
    </div>
  );
}
