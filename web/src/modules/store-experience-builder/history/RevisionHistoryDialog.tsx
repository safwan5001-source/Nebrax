"use client";

/**
 * CUST-H5-4 — نافذة «السجل المحفوظ»: لقطات الحفظ الناجح لنسخة التصميم المفتوحة بلغة التاجر (وقت مطلق + نسبي، علامة «مطابقة
 * للحالية»)، لكل لقطة معاينة واسترداد. عرضية بحتة: الشبكة وحالة المحرِّر في `ExperienceBuilder`.
 *
 * النسخة المنشورة لا تُعدَّل أبداً: زر الاسترداد فيها «إنشاء مسودة» (يُنشئ نسخة جديدة)، وشرح ذلك ظاهر.
 */

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PresentationVersionRevisionSummary } from "@/modules/commerce-workspace/presentation-versions";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "../messages";
import { absoluteTimeLabel, relativeTimeLabel } from "./revision-time";

export type RevisionHistoryListState = "loading" | "error" | "ready";

export function RevisionHistoryDialog({
  locale,
  versionName,
  published,
  dirty,
  listState,
  revisions,
  busyId,
  onPreview,
  onRestore,
  onRetry,
  onClose,
}: {
  locale: CustomizerLocale;
  versionName: string;
  /** النسخة المفتوحة منشورة: الاسترداد = إنشاء مسودة جديدة. */
  published: boolean;
  /** في المحرِّر تعديلات غير محفوظة سيستبدلها الاسترداد (ويمكن التراجع عنه). */
  dirty: boolean;
  listState: RevisionHistoryListState;
  revisions: PresentationVersionRevisionSummary[];
  /** لقطة قيد التحميل لمعاينة/استرداد — تُعطَّل بقية الأزرار. */
  busyId: string | null;
  onPreview: (revision: PresentationVersionRevisionSummary) => void;
  onRestore: (revision: PresentationVersionRevisionSummary) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const [nowMs] = useState(() => Date.now());
  const panelRef = useRef<HTMLElement | null>(null);

  // التركيز يدخل النافذة عند الفتح (أول عنصر قابل للتركيز)؛ المستدعي يعيده إلى زرّ الفتح عند الإغلاق.
  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>("button:not([disabled])");
    (first ?? panelRef.current)?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    // حبس التركيز داخل النافذة (aria-modal): Tab من الأخير يعود للأول وعكسه.
    const focusables = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [],
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const restoreLabel = t(published ? "historyCreateDraftAction" : "historyRestoreAction");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revision-history-title"
        data-revision-history-dialog=""
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-border bg-surface shadow-2xl sm:rounded-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="revision-history-title" className="text-sm font-semibold text-text">
              {t("historyTitle")}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              <bdi>{versionName}</bdi>
            </p>
          </div>
          <button
            type="button"
            data-history-close=""
            aria-label={t("historyClose")}
            onClick={onClose}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-primary-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="text-xs leading-5 text-muted">{t(published ? "historyIntroPublished" : "historyIntro")}</p>
          {dirty && !published ? (
            <p
              data-history-dirty-note=""
              className="mt-2 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs leading-5 text-warning"
            >
              {t("historyDirtyNote")}
            </p>
          ) : null}

          {listState === "loading" ? (
            <p role="status" data-history-loading="" className="py-8 text-center text-xs text-muted">
              {t("historyLoading")}
            </p>
          ) : listState === "error" ? (
            <div data-history-error="" role="alert" className="py-6 text-center">
              <p className="text-xs text-negative">{t("historyLoadFailed")}</p>
              <button
                type="button"
                data-history-retry=""
                onClick={onRetry}
                className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t("retry")}
              </button>
            </div>
          ) : revisions.length === 0 ? (
            <p data-history-empty="" className="py-8 text-center text-xs leading-5 text-muted">
              {t("historyEmpty")}
            </p>
          ) : (
            <ol className="mt-3 divide-y divide-border rounded-md border border-border" data-history-list="">
              {revisions.map((revision) => {
                const busy = busyId === revision.id;
                const disabled = busyId !== null;
                const restoreDisabled = disabled || (revision.isCurrent && !published);
                return (
                  <li
                    key={revision.id}
                    data-history-row=""
                    data-history-current={revision.isCurrent ? "true" : undefined}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-text">
                        <bdi>{relativeTimeLabel(revision.createdAt, locale, nowMs)}</bdi>
                        {revision.isCurrent ? (
                          <span className="rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-normal text-positive">
                            {t("historyCurrentBadge")}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        <bdi>{absoluteTimeLabel(revision.createdAt, locale)}</bdi>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        data-history-preview=""
                        disabled={disabled}
                        aria-busy={busy || undefined}
                        onClick={() => onPreview(revision)}
                        className="min-h-9 rounded-md border border-border px-3 text-xs font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t("historyPreviewAction")}
                      </button>
                      <button
                        type="button"
                        data-history-restore=""
                        disabled={restoreDisabled}
                        aria-busy={busy || undefined}
                        title={revision.isCurrent && !published ? t("historyRestoreCurrentDisabled") : undefined}
                        onClick={() => onRestore(revision)}
                        className="min-h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {restoreLabel}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
