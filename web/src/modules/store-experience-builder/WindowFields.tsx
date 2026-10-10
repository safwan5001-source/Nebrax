"use client";

/**
 * CUST-HV V3 / V6c-1 — the start/end editor shared by announcement messages and
 * the Banner section. One component, one semantic: the window is the same
 * `{startsAt?, endsAt?}` UTC pair evaluated by the one predicate
 * (`announcementWindowState`), so the two surfaces can never drift.
 */
import { useState } from "react";
import {
  safeTimeZone,
  timeZoneDisplayLabel,
  utcIsoToZonedWallTime,
  zonedWallTimeToUtcIso,
} from "@/lib/timezone";
import { btnClass, inputClass } from "./ControlPanels";
import type { CustomizerLocale, CustomizerMessageKey } from "./messages";

export type DisplayWindow = { startsAt?: string; endsAt?: string };

/**
 * Start/end of the display window. The merchant types wall-clock date + time
 * in the *store's* zone (never the browser's); the stored value is the exact
 * UTC instant. A half-filled edge is held locally and not written, so the
 * normaliser never sees a value it would have to guess about.
 */
export function WindowFields({
  scope,
  window,
  locale,
  timezone,
  invalid,
  t,
  onChange,
}: {
  /** Stable id of the owner (message / section) — remounts the edges when the editor switches target. */
  scope: string;
  window: DisplayWindow | undefined;
  locale: CustomizerLocale;
  timezone: string;
  invalid: boolean;
  t: (key: CustomizerMessageKey) => string;
  onChange: (window: DisplayWindow | undefined) => void;
}) {
  const zone = safeTimeZone(timezone);
  const write = (edge: "startsAt" | "endsAt", iso: string | undefined) => {
    const next = { ...(window ?? {}) };
    if (iso === undefined) delete next[edge];
    else next[edge] = iso;
    onChange(
      next.startsAt === undefined && next.endsAt === undefined
        ? undefined
        : next,
    );
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-[12px] font-medium text-muted">
        {t("annWindow")}
      </legend>
      <p className="text-[12px] text-muted">
        {timeZoneDisplayLabel(zone, locale)}
      </p>
      <WindowEdge
        key={`${scope}-start-${window?.startsAt ?? ""}-${zone}`}
        label={t("annStarts")}
        stored={window?.startsAt}
        zone={zone}
        t={t}
        onCommit={(iso) => write("startsAt", iso)}
      />
      <WindowEdge
        key={`${scope}-end-${window?.endsAt ?? ""}-${zone}`}
        label={t("annEnds")}
        stored={window?.endsAt}
        zone={zone}
        t={t}
        onCommit={(iso) => write("endsAt", iso)}
      />
      {invalid ? (
        <p role="alert" className="text-[12px] leading-5 text-negative">
          {t("annWindowInvalid")}
        </p>
      ) : null}
    </fieldset>
  );
}

function WindowEdge({
  label,
  stored,
  zone,
  t,
  onCommit,
}: {
  label: string;
  stored: string | undefined;
  zone: string;
  t: (key: CustomizerMessageKey) => string;
  onCommit: (iso: string | undefined) => void;
}) {
  const parsed = stored ? utcIsoToZonedWallTime(stored, zone) : null;
  const unreadable = stored !== undefined && parsed === null;
  const [date, setDate] = useState(parsed?.date ?? "");
  const [time, setTime] = useState(parsed?.time ?? "");
  const partial = (date === "") !== (time === "");

  const update = (nextDate: string, nextTime: string) => {
    setDate(nextDate);
    setTime(nextTime);
    if (nextDate === "" && nextTime === "") {
      onCommit(undefined);
      return;
    }
    if (nextDate === "" || nextTime === "") return; // wait for the other half
    const iso = zonedWallTimeToUtcIso(nextDate, nextTime, zone);
    if (iso) onCommit(iso);
  };

  return (
    <div className="space-y-1">
      <span className="block text-[12px] text-muted">{label}</span>
      <div className="space-y-2">
        <input
          type="date"
          dir="ltr"
          aria-label={`${label} — ${t("annDate")}`}
          className={`${inputClass} min-w-0`}
          value={date}
          onChange={(event) => update(event.target.value, time)}
        />
        <div className="flex items-center gap-2">
          <input
            type="time"
            dir="ltr"
            aria-label={`${label} — ${t("annTime")}`}
            className={`${inputClass} min-w-0 flex-1`}
            value={time}
            onChange={(event) => update(date, event.target.value)}
          />
          <button
            type="button"
            className={`${btnClass} h-10 shrink-0`}
            disabled={date === "" && time === "" && stored === undefined}
            onClick={() => update("", "")}
          >
            {t("annClear")}
          </button>
        </div>
      </div>
      {partial ? (
        <p className="text-[12px] text-warning">{t("annWindowPartial")}</p>
      ) : null}
      {unreadable ? (
        <p className="text-[12px] text-negative">{t("annWindowUnreadable")}</p>
      ) : null}
    </div>
  );
}
