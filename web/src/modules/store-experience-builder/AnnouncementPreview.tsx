"use client";

/**
 * CUST-HV V3 — editor Canvas preview of the announcement bar.
 *
 * Static by design: it shows the first message that would be eligible on the
 * page being previewed (same predicate as the storefront — `eligibleAnnouncements`),
 * with the same icon registry and the same surface resolution. Rotation, ticker
 * and dismissal are *named* in a small editor-only line rather than animated —
 * the Canvas must stay still while the merchant edits, and the real motion is
 * proven in the storefront component.
 */
import { useEffect, useState } from "react";
import { ANNOUNCEMENT_ICON_COMPONENTS } from "./announcement-icons";
import {
  type CustomizerLocale,
  type CustomizerMessageKey,
  customizerMessage,
} from "./messages";
import {
  type AnnouncementPageKind,
  type AnnouncementsDoc,
  eligibleAnnouncements,
  resolveAnnouncementSurface,
} from "./presentation/announcements";
import type { PageType } from "./presentation/page-regions";

/** Fixed bar height in the preview — the sticky header offsets by exactly this. */
export const ANNOUNCEMENT_PREVIEW_HEIGHT = 36;

export function previewAnnouncementPageKind(
  page: PageType,
): AnnouncementPageKind {
  return page === "product" ? "product" : page === "category" ? "category" : "home";
}

/** Whether the bar draws at all — the Canvas needs this to offset a sticky header. */
export function announcementBarVisible(
  doc: AnnouncementsDoc | undefined,
): boolean {
  return Boolean(doc?.enabled && doc.items.length > 0);
}

export function AnnouncementPreview({
  doc,
  page,
  locale,
  selected = false,
  onSelect,
}: {
  doc: AnnouncementsDoc | undefined;
  page: PageType;
  locale: CustomizerLocale;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  // `Date.now()` after mount only — the Canvas is rendered on the server too
  // and must not bake the server clock into the markup.
  const [nowMs, setNowMs] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate windows whenever the document itself changes
  useEffect(() => {
    setNowMs(Date.now());
  }, [doc]);

  if (!doc || !announcementBarVisible(doc) || nowMs === null) return null;

  const kind = previewAnnouncementPageKind(page);
  const eligible = eligibleAnnouncements(doc, kind, nowMs);
  const first = eligible[0];
  const surface = first ? resolveAnnouncementSurface(first.surface) : null;
  const Icon = first?.icon ? ANNOUNCEMENT_ICON_COMPONENTS[first.icon] : null;
  const behaviour = doc.behaviour ?? {};
  const hidden = doc.items.length - eligible.length;

  const traits: string[] = [];
  if (behaviour.ticker) traits.push(t("annTicker"));
  else if (behaviour.rotate && eligible.length > 1)
    traits.push(`${t("annRotate")} 1/${eligible.length}`);
  if (behaviour.sticky) traits.push(t("annSticky"));
  if (behaviour.dismissible) traits.push(t("annDismissible"));

  return (
    <div
      data-preview-chrome={onSelect ? "announcements" : undefined}
      data-announcement-preview=""
      data-chrome-selected={onSelect && selected ? "" : undefined}
      onClick={onSelect}
      className={`${behaviour.sticky ? "sticky top-0 z-30" : "relative"} ${
        onSelect ? "awj-preview-section" : ""
      } ${selected ? "awj-preview-section-selected" : ""}`}
    >
      {onSelect ? (
        <button
          type="button"
          className="sr-only"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {t("announcements")}
        </button>
      ) : null}
      <div
        style={{
          height: ANNOUNCEMENT_PREVIEW_HEIGHT,
          ...(surface
            ? { background: surface.background, color: surface.foreground }
            : {}),
        }}
        className={`flex items-center justify-center gap-2 border-b border-store-border/20 px-3 text-center text-[13px] ${
          surface ? "" : "bg-store-primary text-store-primary-foreground"
        }`}
      >
        {first ? (
          <>
            {Icon ? (
              <Icon aria-hidden="true" className="size-4 shrink-0" />
            ) : null}
            <span
              className="min-w-0 truncate"
              style={
                first.href && surface ? { color: surface.link } : undefined
              }
            >
              {first.text}
            </span>
          </>
        ) : (
          <span className="opacity-80">{t("annPreviewNoEligible")}</span>
        )}
      </div>
      {traits.length > 0 || hidden > 0 ? (
        <p
          data-editor-only=""
          className="border-b border-dashed border-store-border bg-store-surface-muted px-3 py-0.5 text-center text-[10px] text-store-muted-foreground"
        >
          {t("annPreviewEditorOnly")}
          {traits.length > 0 ? ` · ${traits.join(" · ")}` : ""}
          {hidden > 0 && first ? ` · ${hidden} ${t("annPreviewHiddenCount")}` : ""}
        </p>
      ) : null}
    </div>
  );
}
