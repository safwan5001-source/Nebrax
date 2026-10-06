"use client";

/**
 * CUST-HV V3 — "Announcements" inspector panel.
 *
 * Edits `config.announcements` only. Every control maps to a field the three
 * normalisers (PHP authority + web/storefront twins) already own; this file
 * never invents a value the normaliser would drop, and it never blocks a
 * Draft — the publish gate (PHP) is where a bad window or unreadable colour
 * pair is refused, and the panel shows the same verdict *before* the merchant
 * gets there (contrast ratio, inverted window).
 */
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import {
  safeTimeZone,
  timeZoneDisplayLabel,
  utcIsoToZonedWallTime,
  zonedWallTimeToUtcIso,
} from "@/lib/timezone";
import { ANNOUNCEMENT_ICON_COMPONENTS } from "./announcement-icons";
import {
  type AnnouncementEditorStatus,
  announcementEditorStatus,
} from "./announcement-status";
import {
  Field,
  Section,
  Segmented,
  Toggle,
  btnClass,
  inputClass,
  selectClass,
} from "./ControlPanels";
import {
  type CustomizerLocale,
  type CustomizerMessageKey,
  customizerMessage,
} from "./messages";
import {
  ANNOUNCEMENT_ICONS,
  ANNOUNCEMENT_MAX_ITEMS,
  ANNOUNCEMENT_ROTATE_INTERVALS,
  ANNOUNCEMENT_TEXT_MAX,
  ANNOUNCEMENT_TICKER_SPEEDS,
  type Announcement,
  type AnnouncementBehaviour,
  type AnnouncementIconKey,
  type AnnouncementsDoc,
  MIN_TEXT_CONTRAST,
  announcementWindowState,
  autoForeground,
  normalizeAnnouncementHref,
} from "./presentation/announcements";
import { contrastRatio, isSafeHexColor } from "./presentation/tokens";

/** Row actions: 44 px touch targets on phones, 36 px where a pointer is the norm. */
const rowBtnClass =
  "inline-flex size-11 shrink-0 items-center justify-center text-muted hover:bg-background hover:text-text disabled:text-border disabled:hover:bg-transparent md:size-9";
const EMPTY_DOC: AnnouncementsDoc = { enabled: false, items: [] };
const PAGE_OPTIONS = ["home", "product", "category"] as const;

const STATUS_KEY: Record<AnnouncementEditorStatus, CustomizerMessageKey> = {
  live: "annStatusLive",
  disabled: "annStatusDisabled",
  empty: "annStatusEmpty",
  scheduled: "annStatusScheduled",
  expired: "annStatusExpired",
  invalid: "annStatusInvalid",
};
const STATUS_TONE: Record<AnnouncementEditorStatus, string> = {
  live: "bg-primary-soft text-positive",
  disabled: "bg-background text-muted",
  empty: "bg-background text-muted",
  scheduled: "bg-primary-soft text-primary",
  expired: "bg-background text-muted",
  invalid: "bg-background text-negative",
};

function newItemId(existing: readonly Announcement[]): string {
  for (;;) {
    const id = `ann-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!existing.some((item) => item.id === id)) return id;
  }
}

function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function AnnouncementsPanel({
  doc,
  locale,
  timezone,
  defaultBackground,
  onChange,
}: {
  doc: AnnouncementsDoc | undefined;
  locale: CustomizerLocale;
  timezone: string;
  /** Starting colour for a custom surface — the store's own primary, so the first click is already on-brand. */
  defaultBackground: string;
  onChange: (next: AnnouncementsDoc) => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const current = doc ?? EMPTY_DOC;
  const [openId, setOpenId] = useState<string | null>(
    current.items[0]?.id ?? null,
  );
  // Evaluated per render on purpose: a status chip must not go stale while the
  // panel is open, and the panel only renders client-side.
  const nowMs = Date.now();

  const commit = (next: Partial<AnnouncementsDoc>) =>
    onChange({ ...current, ...next });
  const setItem = (index: number, partial: Partial<Announcement>) =>
    commit({
      items: current.items.map((item, i) =>
        i === index ? { ...item, ...partial } : item,
      ),
    });
  const behaviour = current.behaviour ?? {};
  const setBehaviour = (next: AnnouncementBehaviour) => {
    const clean = Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined),
    ) as AnnouncementBehaviour;
    // `behaviour` stays present-but-empty rather than deleted: the normaliser
    // drops an empty object, so the stored shape is canonical either way.
    commit({ behaviour: clean });
  };

  const atLimit = current.items.length >= ANNOUNCEMENT_MAX_ITEMS;

  return (
    <div className="space-y-6" data-announcements-panel="">
      <p className="text-[12px] leading-5 text-muted">{t("annIntro")}</p>
      <div className="border-y border-border">
        <Toggle
          label={t("annEnable")}
          checked={current.enabled}
          onChange={(enabled) => commit({ enabled })}
        />
      </div>

      <Section title={t("annItems")}>
        {current.items.length === 0 ? (
          <p className="text-[12px] leading-5 text-muted">
            {t("annEmptyList")}
          </p>
        ) : (
          <ul className="space-y-2">
            {current.items.map((item, index) => {
              const status = announcementEditorStatus(item, nowMs);
              const open = openId === item.id;
              return (
                <li
                  key={item.id}
                  className="border border-border bg-surface"
                  data-announcement-item={item.id}
                >
                  <div className="flex items-center gap-1 ps-3 pe-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${t("annEdit")} ${index + 1}`}
                      onClick={() => setOpenId(open ? null : item.id)}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-start"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                        {item.text.trim() === ""
                          ? t("annTextEmptyPreview")
                          : item.text}
                      </span>
                      <span
                        className={`shrink-0 px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}
                      >
                        {t(STATUS_KEY[status])}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={rowBtnClass}
                      aria-label={t("annMoveUp")}
                      disabled={index === 0}
                      onClick={() =>
                        commit({ items: moveItem(current.items, index, -1) })
                      }
                    >
                      <ChevronUp aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      className={rowBtnClass}
                      aria-label={t("annMoveDown")}
                      disabled={index === current.items.length - 1}
                      onClick={() =>
                        commit({ items: moveItem(current.items, index, 1) })
                      }
                    >
                      <ChevronDown aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      className={rowBtnClass}
                      aria-label={t("annRemove")}
                      onClick={() => {
                        commit({
                          items: current.items.filter((_, i) => i !== index),
                        });
                        if (open) setOpenId(null);
                      }}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                  {open ? (
                    <ItemEditor
                      item={item}
                      locale={locale}
                      timezone={timezone}
                      defaultBackground={defaultBackground}
                      nowMs={nowMs}
                      t={t}
                      onChange={(partial) => setItem(index, partial)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="space-y-1">
          <button
            type="button"
            className={`${btnClass} h-9 gap-1.5`}
            disabled={atLimit}
            onClick={() => {
              const id = newItemId(current.items);
              commit({
                items: [
                  ...current.items,
                  { id, text: "", enabled: true },
                ],
              });
              setOpenId(id);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            {t("annAdd")}
          </button>
          {atLimit ? (
            <p className="text-[12px] text-muted">{t("annLimit")}</p>
          ) : null}
        </div>
      </Section>

      <Section title={t("annBehaviour")}>
        <div className="border-y border-border">
          <Toggle
            label={t("annRotate")}
            checked={Boolean(behaviour.rotate)}
            disabled={Boolean(behaviour.ticker)}
            onChange={(rotate) =>
              setBehaviour({
                ...behaviour,
                rotate: rotate ? true : undefined,
                rotateInterval: rotate ? behaviour.rotateInterval : undefined,
              })
            }
          />
          {behaviour.rotate && !behaviour.ticker ? (
            <div className="pb-3">
              <Field label={t("annRotateInterval")}>
                <Segmented
                  value={String(behaviour.rotateInterval ?? 8)}
                  onChange={(value) =>
                    setBehaviour({
                      ...behaviour,
                      rotateInterval:
                        value === "8"
                          ? undefined
                          : (Number(value) as AnnouncementBehaviour["rotateInterval"]),
                    })
                  }
                  options={ANNOUNCEMENT_ROTATE_INTERVALS.map((seconds) => ({
                    id: String(seconds),
                    label: `${seconds} ${t("annSeconds")}`,
                  }))}
                />
              </Field>
            </div>
          ) : null}
          <Toggle
            label={t("annTicker")}
            checked={Boolean(behaviour.ticker)}
            onChange={(ticker) =>
              setBehaviour({
                ...behaviour,
                ticker: ticker ? true : undefined,
                tickerSpeed: ticker ? behaviour.tickerSpeed : undefined,
                // A ticker excludes rotation — same rule the normaliser applies.
                rotate: ticker ? undefined : behaviour.rotate,
                rotateInterval: ticker ? undefined : behaviour.rotateInterval,
              })
            }
          />
          <p className="pb-2 text-[12px] leading-5 text-muted">
            {t("annTickerHint")}
          </p>
          {behaviour.ticker ? (
            <div className="pb-3">
              <Field label={t("annTickerSpeed")}>
                <Segmented
                  value={behaviour.tickerSpeed ?? "normal"}
                  onChange={(speed) =>
                    setBehaviour({
                      ...behaviour,
                      tickerSpeed: speed === "normal" ? undefined : speed,
                    })
                  }
                  options={ANNOUNCEMENT_TICKER_SPEEDS.map((speed) => ({
                    id: speed,
                    label: t(
                      speed === "slow"
                        ? "annSpeedSlow"
                        : speed === "fast"
                          ? "annSpeedFast"
                          : "annSpeedNormal",
                    ),
                  }))}
                />
              </Field>
            </div>
          ) : null}
          <Toggle
            label={t("annSticky")}
            checked={Boolean(behaviour.sticky)}
            onChange={(sticky) =>
              setBehaviour({ ...behaviour, sticky: sticky ? true : undefined })
            }
          />
          <Toggle
            label={t("annDismissible")}
            checked={Boolean(behaviour.dismissible)}
            onChange={(dismissible) =>
              setBehaviour({
                ...behaviour,
                dismissible: dismissible ? true : undefined,
              })
            }
          />
        </div>
      </Section>
    </div>
  );
}

function ItemEditor({
  item,
  locale,
  timezone,
  defaultBackground,
  nowMs,
  t,
  onChange,
}: {
  item: Announcement;
  locale: CustomizerLocale;
  timezone: string;
  defaultBackground: string;
  nowMs: number;
  t: (key: CustomizerMessageKey) => string;
  onChange: (partial: Partial<Announcement>) => void;
}) {
  const codePoints = Array.from(item.text).length;
  const hrefRaw = item.href ?? "";
  const surface = item.surface;
  const backgroundHex = surface?.background.hex;
  const textHex =
    backgroundHex === undefined
      ? undefined
      : (surface?.text?.hex ?? autoForeground(backgroundHex));
  const ratio =
    backgroundHex !== undefined && textHex !== undefined
      ? contrastRatio(textHex, backgroundHex)
      : null;
  const customTextFails =
    surface?.text !== undefined && ratio !== null && ratio < MIN_TEXT_CONTRAST;
  const pages = item.pages ?? [];
  const windowInvalid = announcementWindowState(item.window, nowMs) === "invalid";

  const setSurface = (next: Announcement["surface"] | undefined) =>
    onChange({ surface: next });

  return (
    <div className="space-y-4 border-t border-border p-3">
      <Toggle
        label={t("annItemEnabled")}
        checked={item.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />

      <div className="space-y-1">
        <Field label={t("annText")} hint={t("annTextHint")}>
          <textarea
            className={`${inputClass} h-16 py-2`}
            value={item.text}
            maxLength={ANNOUNCEMENT_TEXT_MAX * 2}
            onChange={(event) => onChange({ text: event.target.value })}
          />
        </Field>
        <span
          className={`block text-end text-[11px] tabular-nums ${
            codePoints > ANNOUNCEMENT_TEXT_MAX
              ? "text-negative"
              : "text-muted"
          }`}
        >
          {codePoints}/{ANNOUNCEMENT_TEXT_MAX}
        </span>
      </div>

      <Field label={t("annIcon")}>
        <select
          className={selectClass}
          value={item.icon ?? ""}
          onChange={(event) =>
            onChange({
              icon: (event.target.value || undefined) as
                | AnnouncementIconKey
                | undefined,
            })
          }
        >
          <option value="">{t("annIconNone")}</option>
          {ANNOUNCEMENT_ICONS.map((key) => (
            <option key={key} value={key}>
              {t(`annIcon_${key}` as CustomizerMessageKey)}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={t("annLink")}
        hint={
          hrefRaw !== "" && normalizeAnnouncementHref(hrefRaw) === null
            ? t("annLinkInvalid")
            : t("annLinkHint")
        }
      >
        <input
          className={`${inputClass} font-mono`}
          dir="ltr"
          inputMode="url"
          value={hrefRaw}
          onChange={(event) =>
            onChange({ href: event.target.value === "" ? undefined : event.target.value })
          }
        />
      </Field>

      <div className="space-y-2">
        <span className="block text-[12px] font-medium text-muted">
          {t("annSurface")}
        </span>
        <Segmented
          value={surface ? "custom" : "theme"}
          onChange={(mode) =>
            setSurface(
              mode === "theme"
                ? undefined
                : { background: { hex: defaultBackground.toLowerCase() } },
            )
          }
          options={[
            { id: "theme" as const, label: t("annSurfaceTheme") },
            { id: "custom" as const, label: t("annSurfaceCustom") },
          ]}
        />
        {surface && backgroundHex !== undefined && textHex !== undefined ? (
          <div className="space-y-3 pt-1">
            <ColourField
              label={t("annBackground")}
              hex={backgroundHex}
              onChange={(hex) =>
                setSurface({ ...surface, background: { hex } })
              }
            />
            <div className="space-y-1.5">
              <span className="block text-[12px] font-medium text-muted">
                {t("annTextColour")}
              </span>
              <Segmented
                value={surface.text ? "custom" : "auto"}
                onChange={(mode) => {
                  const { text: _drop, ...rest } = surface;
                  setSurface(
                    mode === "auto"
                      ? rest
                      : { ...rest, text: { hex: autoForeground(backgroundHex) } },
                  );
                }}
                options={[
                  { id: "auto" as const, label: t("annTextAuto") },
                  { id: "custom" as const, label: t("annTextCustom") },
                ]}
              />
              {surface.text ? (
                <ColourField
                  label={t("annTextColour")}
                  hex={surface.text.hex}
                  onChange={(hex) =>
                    setSurface({ ...surface, text: { hex } })
                  }
                  hideLabel
                />
              ) : null}
            </div>
            {ratio !== null ? (
              <p
                data-announcement-contrast=""
                role="status"
                className={`text-[12px] leading-5 ${
                  customTextFails ? "text-negative" : "text-muted"
                }`}
              >
                {t("annContrast")}:{" "}
                <span className="tabular-nums" dir="ltr">
                  {ratio.toFixed(2)}:1
                </span>{" "}
                ·{" "}
                {customTextFails
                  ? `${t("annContrastFail")}. ${t("annContrastFallback")}`
                  : t("annContrastOk")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <WindowFields
        item={item}
        locale={locale}
        timezone={timezone}
        invalid={windowInvalid}
        t={t}
        onChange={(window) => onChange({ window })}
      />

      <fieldset className="space-y-1.5">
        <legend className="text-[12px] font-medium text-muted">
          {t("annPages")}
        </legend>
        <div className="flex flex-wrap gap-x-4">
          {PAGE_OPTIONS.map((page) => (
            <label
              key={page}
              className="flex min-h-11 items-center gap-2 text-[13px] text-text"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={pages.includes(page)}
                onChange={(event) => {
                  const chosen = new Set(pages);
                  if (event.target.checked) chosen.add(page);
                  else chosen.delete(page);
                  // Canonical order; empty (or all three) = every eligible page.
                  const next = PAGE_OPTIONS.filter((p) => chosen.has(p));
                  onChange({
                    pages:
                      next.length === 0 || next.length === PAGE_OPTIONS.length
                        ? undefined
                        : [...next],
                  });
                }}
              />
              {t(
                page === "home"
                  ? "annPageHome"
                  : page === "product"
                    ? "annPageProduct"
                    : "annPageCategory",
              )}
            </label>
          ))}
        </div>
        <p className="text-[12px] leading-5 text-muted">
          {t("annPagesAllHint")}
        </p>
      </fieldset>
    </div>
  );
}

function ColourField({
  label,
  hex,
  onChange,
  hideLabel = false,
}: {
  label: string;
  hex: string;
  onChange: (hex: string) => void;
  hideLabel?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  return (
    <div className="space-y-1">
      {hideLabel ? null : (
        <label
          htmlFor={id}
          className="block text-[12px] font-medium text-muted"
        >
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          className="size-10 shrink-0 cursor-pointer border border-border bg-surface p-0.5"
          value={hex}
          onChange={(event) => {
            setDraft(null);
            onChange(event.target.value.toLowerCase());
          }}
        />
        <input
          id={id}
          dir="ltr"
          className={`${inputClass} font-mono`}
          value={draft ?? hex}
          maxLength={7}
          spellCheck={false}
          onChange={(event) => {
            const value = event.target.value.trim();
            setDraft(value);
            if (isSafeHexColor(value)) {
              onChange(value.toLowerCase());
              setDraft(null);
            }
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
    </div>
  );
}

/**
 * Start/end of the display window. The merchant types wall-clock date + time
 * in the *store's* zone (never the browser's); the stored value is the exact
 * UTC instant. A half-filled edge is held locally and not written, so the
 * normaliser never sees a value it would have to guess about.
 */
function WindowFields({
  item,
  locale,
  timezone,
  invalid,
  t,
  onChange,
}: {
  item: Announcement;
  locale: CustomizerLocale;
  timezone: string;
  invalid: boolean;
  t: (key: CustomizerMessageKey) => string;
  onChange: (window: Announcement["window"] | undefined) => void;
}) {
  const zone = safeTimeZone(timezone);
  const write = (edge: "startsAt" | "endsAt", iso: string | undefined) => {
    const next = { ...(item.window ?? {}) };
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
        key={`${item.id}-start`}
        label={t("annStarts")}
        stored={item.window?.startsAt}
        zone={zone}
        t={t}
        onCommit={(iso) => write("startsAt", iso)}
      />
      <WindowEdge
        key={`${item.id}-end`}
        label={t("annEnds")}
        stored={item.window?.endsAt}
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
