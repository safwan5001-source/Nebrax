"use client";

/**
 * CUST-H5-4 — شريط معاينة لقطة محفوظة (فوق الـCanvas): يشرح أن العرض للقراءة فقط، ويعرض **مشاكل الوسائط الحالية** لهذه اللقطة
 * مجمَّعةً بلغة التاجر (لا مسارات تقنية)، ويقدّم الفعل الوحيد: استرداد (أو «إنشاء مسودة» لنسخة منشورة) أو الخروج. لا يغيّر شيئاً.
 */

import type { PresentationMediaIssue, PresentationVersionRevisionDetail } from "@/modules/commerce-workspace/presentation-versions";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "../messages";
import { fillTemplate } from "../slider-edit";
import { absoluteTimeLabel, relativeTimeLabel } from "./revision-time";

const ISSUE_LABEL: Record<string, CustomizerMessageKey> = {
  media_missing: "historyMediaMissing",
  media_not_ready: "historyMediaNotReady",
  derivative_not_ready: "historyMediaNotReady",
  derivative_failed: "historyMediaNotReady",
};

/** مجموعة مشاكل بنفس السبب (للعرض: «الصورة محذوفة أو غير متاحة ×2»). */
export function groupMediaIssues(issues: readonly PresentationMediaIssue[]): { key: CustomizerMessageKey; count: number }[] {
  const counts = new Map<CustomizerMessageKey, number>();
  for (const issue of issues) {
    const key = ISSUE_LABEL[issue.code] ?? "historyMediaNotReady";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, count]) => ({ key, count }));
}

export function HistoryPreviewBar({
  locale,
  revision,
  published,
  dirty,
  busy,
  onRestore,
  onExit,
}: {
  locale: CustomizerLocale;
  revision: PresentationVersionRevisionDetail;
  published: boolean;
  /** تعديلات غير محفوظة في المحرّر: استرداد اللقطة «الحالية» يظل مفيداً عندها. */
  dirty: boolean;
  busy: boolean;
  onRestore: () => void;
  onExit: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const restoreIsNoop = revision.isCurrent && !published && !dirty;
  const groups = groupMediaIssues(revision.mediaIssues);
  return (
    <section
      data-history-preview-bar=""
      aria-label={t("historyPreviewTitle")}
      className="shrink-0 border-b border-border bg-surface px-3 py-3 md:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{t("historyPreviewTitle")}</p>
          <h2 className="text-base font-semibold text-text">
            <bdi>{relativeTimeLabel(revision.createdAt, locale, Date.now())}</bdi>
            <span className="ms-2 text-xs font-normal text-muted">
              <bdi>{absoluteTimeLabel(revision.createdAt, locale)}</bdi>
            </span>
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{t("historyPreviewNote")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            data-history-preview-exit=""
            onClick={onExit}
            disabled={busy}
            className="min-h-9 rounded-md border border-border px-3 text-xs font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            {t("historyPreviewExit")}
          </button>
          <button
            type="button"
            data-history-preview-restore=""
            onClick={onRestore}
            disabled={busy || restoreIsNoop}
            title={restoreIsNoop ? t("historyRestoreCurrentDisabled") : undefined}
            className="min-h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t(published ? "historyCreateDraftAction" : "historyRestoreAction")}
          </button>
        </div>
      </div>
      {groups.length > 0 ? (
        <div
          role="alert"
          data-history-media-issues=""
          className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs leading-5 text-warning"
        >
          <p className="font-medium">{t("historyMediaIssuesTitle")}</p>
          <p>{fillTemplate(t("historyMediaIssuesBody"), { n: revision.mediaIssues.length })}</p>
          <ul className="mt-1 list-disc ps-4">
            {groups.map(({ key, count }) => (
              <li key={key}>
                {t(key)}
                {count > 1 ? ` ×${count}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
