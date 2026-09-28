"use client";

/**
 * CUST-H1-2 — لوحة إدارة نسخ التصميم. عرضية بحتة: كل الحالة والانتقال بين
 * الشبكة تُدار في `ExperienceBuilder`؛ هذا المكوّن يُستدعى من موضعين
 * (Popover في سطح المكتب، Bottom Sheet في الجوال) بنفس السلوك — لا تكرار
 * منطق. الحالة المشتقة (draft/scheduled/published) تأتي من الخادم حصراً
 * (`StorefrontPresentationVersionService::deriveState`)، ولا نموذج حالة
 * محلي يُخترع هنا.
 */

import { useState } from "react";
import { formatDateTime } from "@/lib/formatting";
import type {
  PresentationVersionState,
  PresentationVersionSummary,
} from "@/modules/commerce-workspace/presentation-versions";
import { type CustomizerLocale, customizerMessage } from "./messages";

export type VersionManagerListState = "loading" | "error" | "ready";

export type VersionRowAction = "duplicate" | "rename" | "delete" | null;

export interface VersionManagerPanelProps {
  locale: CustomizerLocale;
  listState: VersionManagerListState;
  versions: PresentationVersionSummary[];
  selectedVersionId: string | null;
  /** Version id currently mid-switch (GET in flight) — disables further selection. */
  switchingVersionId: string | null;
  creating: boolean;
  /** Which row + which action currently has a write in flight. */
  busyVersionId: string | null;
  busyAction: VersionRowAction;
  onRetryList: () => void;
  onSelect: (version: PresentationVersionSummary) => void;
  onCreate: (name: string) => void;
  onDuplicate: (version: PresentationVersionSummary, name: string) => void;
  onRename: (version: PresentationVersionSummary, name: string) => void;
  onDelete: (version: PresentationVersionSummary) => void;
}

function stateLabel(state: PresentationVersionState, t: (key: Parameters<typeof customizerMessage>[1]) => string) {
  if (state === "published") return t("versionStatePublished");
  if (state === "scheduled") return t("versionStateScheduled");
  return t("versionStateDraft");
}

function defaultDuplicateName(name: string, locale: CustomizerLocale): string {
  // الخادم يرفض `name` أطول من 120 حرفاً (`CreateStorefrontPresentationVersionRequest`)
  // — نسخة باسمٍ قريب من الحدّ تجعل هذا الاسم المولَّد (بادئة + اسمها) يتجاوزه،
  // فيُملأ حقل التعديل بقيمة غير صالحة من البداية (تفشل الإرسال دون تعديلٍ
  // يدوي). نقصّ السلسلة كاملةً (بادئة + اسم) عند 120 حرفاً بدل ترك الافتراضي
  // غير صالح — نفس أسلوب اختصار «إنشاء مسودة من هذه النسخة» للنسخة المنشورة.
  const prefix = locale === "ar" ? "نسخة من " : "Copy of ";
  return `${prefix}${name}`.slice(0, 120);
}

export function VersionManagerPanel({
  locale,
  listState,
  versions,
  selectedVersionId,
  switchingVersionId,
  creating,
  busyVersionId,
  busyAction,
  onRetryList,
  onSelect,
  onCreate,
  onDuplicate,
  onRename,
  onDelete,
}: VersionManagerPanelProps) {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage(locale, key);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  function submitCreate() {
    // الزر المجاور يُعطَّل أثناء `creating`، لكن الإدخال يبقى مركَّزاً — إن
    // أُغلِق النموذج بعد إرسالٍ أول ثم أُعيد فتحه (`+ نسخة جديدة` لا يتحقق من
    // `creating`) واسمٌ جديد كُتب، يستقبل Enter طلباً ثانياً بلا هذا الحارس.
    if (creating) return;
    const name = createName.trim();
    if (!name) return;
    onCreate(name);
    setCreateName("");
    setShowCreateForm(false);
  }

  return (
    <div data-version-manager="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-2">
        <h3 className="text-sm font-semibold text-text">{t("versionManagerTitle")}</h3>
        {listState === "ready" ? (
          <button
            type="button"
            data-version-new=""
            onClick={() => setShowCreateForm((open) => !open)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            + {t("versionNew")}
          </button>
        ) : null}
      </div>

      {showCreateForm ? (
        <div className="mb-2 flex shrink-0 items-center gap-2 rounded-md border border-border bg-primary-soft/40 p-2">
          <label className="sr-only" htmlFor="version-create-name">
            {t("versionNamePrompt")}
          </label>
          <input
            id="version-create-name"
            autoFocus
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitCreate();
              if (event.key === "Escape") setShowCreateForm(false);
            }}
            placeholder={t("versionNamePlaceholder")}
            className="h-9 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-sm text-text outline-none focus:border-primary"
          />
          <button
            type="button"
            data-version-create-submit=""
            disabled={creating || createName.trim() === ""}
            onClick={submitCreate}
            className="h-9 shrink-0 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {creating ? t("versionCreating") : t("versionCreateSubmit")}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {listState === "loading" ? (
          <div role="status" className="space-y-2 p-2">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-14 animate-pulse rounded-md bg-primary-soft/40" />
            ))}
            <span className="sr-only">{t("versionListLoading")}</span>
          </div>
        ) : null}

        {listState === "error" ? (
          <div className="flex flex-col items-start gap-2 p-3 text-sm text-negative">
            <p>{t("versionListLoadError")}</p>
            <button
              type="button"
              onClick={onRetryList}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text hover:bg-primary-soft"
            >
              {t("versionReloadLatest")}
            </button>
          </div>
        ) : null}

        {listState === "ready" && versions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
            <p className="text-sm font-medium text-text">{t("versionEmptyTitle")}</p>
            <p className="text-xs text-muted">{t("versionEmptyBody")}</p>
            <button
              type="button"
              data-version-create-first=""
              onClick={() => setShowCreateForm(true)}
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
            >
              {t("versionCreateFirst")}
            </button>
          </div>
        ) : null}

        {listState === "ready" && versions.length > 0 ? (
          <ul className="flex flex-col gap-1.5 p-1">
            {versions.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                locale={locale}
                selected={version.id === selectedVersionId}
                switching={version.id === switchingVersionId}
                busy={busyVersionId === version.id ? busyAction : null}
                // `versionBusy` في المكوّن الأب فتحة مشتركة واحدة (تصميم مقصود:
                // عملية صفّ واحدة في كل مرة). كان التعطيل مقيَّداً سابقاً بحالة
                // الحذف فقط، فسمح ببدء حذف على صفّ آخر بينما إعادة تسمية على
                // صفّ أول لا تزال معلَّقة — إعادة التسمية تكتمل أولاً فتصفِّر
                // الفتحة بصمت رغم أن الحذف لا يزال قيد التنفيذ فعلياً، فيعاود
                // "فتح" ذلك الصفّ الظهور مفعَّلاً. منع بدء أي عملية جديدة على
                // صفّ آخر طالما صفّ واحد مشغول (أي إجراء)، لا الحذف حصراً، يمنع
                // هذا التداخل من الأساس. لا يُطبَّق هذا على زر «فتح للتعديل» —
                // تبديل النسخة لا يعتمد `versionBusy` أصلاً، والتبديل أثناء
                // انتظار عملية أخرى مدعومٌ ومُختبَر عمداً؛ حراسته الخاصة (حذف
                // هذا الصفّ نفسه أو تبديل نسخة آخر قيد التنفيذ) منفصلة تماماً.
                otherRowBusy={busyVersionId !== null && busyVersionId !== version.id}
                pendingDelete={pendingDeleteId === version.id}
                onOpenDeleteConfirm={() => setPendingDeleteId(version.id)}
                onCancelDeleteConfirm={() => setPendingDeleteId(null)}
                onSelect={() => onSelect(version)}
                onDuplicate={(name) => onDuplicate(version, name)}
                onRename={(name) => onRename(version, name)}
                onDelete={() => {
                  setPendingDeleteId(null);
                  onDelete(version);
                }}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function VersionRow({
  version,
  locale,
  selected,
  switching,
  busy,
  otherRowBusy,
  pendingDelete,
  onOpenDeleteConfirm,
  onCancelDeleteConfirm,
  onSelect,
  onDuplicate,
  onRename,
  onDelete,
}: {
  version: PresentationVersionSummary;
  locale: CustomizerLocale;
  selected: boolean;
  switching: boolean;
  busy: VersionRowAction;
  otherRowBusy: boolean;
  pendingDelete: boolean;
  onOpenDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onSelect: () => void;
  onDuplicate: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage(locale, key);
  const [mode, setMode] = useState<"idle" | "rename" | "duplicate">("idle");
  const [nameDraft, setNameDraft] = useState(version.name);
  const [duplicateDraft, setDuplicateDraft] = useState(defaultDuplicateName(version.name, locale));

  // نمنع حذف النسخة المفتوحة حالياً في هذا المحرِّر احتياطاً — الخادم لا
  // يربط "الحذف" بجلسة المحرِّر، لكن تركُ المحرّر يعرض محتوى نسخة حُذفت للتو
  // تجربة مربكة يمكن تفاديها هنا بلا أي اعتماد على قاعدة خادم جديدة.
  const canDelete = version.state === "draft" && !selected;
  const canDuplicate = true;
  const duplicateLabel =
    version.state === "published" ? t("versionCreateDraftFromThis") : t("versionDuplicate");
  const openLabel = version.state === "published" ? t("versionView") : t("versionOpenEdit");

  return (
    <li
      data-version-row={version.id}
      data-version-state={version.state}
      data-version-selected={selected ? "true" : "false"}
      className={`rounded-md border p-2.5 ${selected ? "border-primary bg-primary-soft/40" : "border-border bg-surface"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text" title={version.name}>
            <bdi>{version.name}</bdi>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
            <span data-version-state-label="" className="font-medium text-text">
              {stateLabel(version.state, t)}
            </span>
            {version.state === "published" ? (
              <span data-version-live-marker="">· {t("versionLiveMarker")}</span>
            ) : null}
            {selected ? <span data-version-current-marker="">· {t("versionCurrentMarker")}</span> : null}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {t("versionLastModified")}:{" "}
            {version.updatedAt ? formatDateTime(version.updatedAt, locale) : t("versionNeverModified")}
          </p>
          {version.state === "scheduled" && version.scheduledFor ? (
            <p className="mt-0.5 text-[11px] text-muted">
              {t("versionScheduledFor")}: {formatDateTime(version.scheduledFor, locale)}
            </p>
          ) : null}
        </div>
      </div>

      {mode === "rename" ? (
        <div className="mt-2 flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`rename-${version.id}`}>
            {t("versionRenameLabel")}
          </label>
          <input
            id={`rename-${version.id}`}
            autoFocus
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setMode("idle");
            }}
            className="h-8 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-xs text-text outline-none focus:border-primary"
          />
          <button
            type="button"
            data-version-rename-submit={version.id}
            disabled={busy === "rename" || nameDraft.trim() === "" || otherRowBusy}
            onClick={() => {
              onRename(nameDraft.trim());
              setMode("idle");
            }}
            className="h-8 shrink-0 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy === "rename" ? t("versionRenaming") : t("versionRenameSubmit")}
          </button>
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="h-8 shrink-0 rounded-md border border-border px-2 text-[11px] text-text"
          >
            {t("versionCancel")}
          </button>
        </div>
      ) : null}

      {mode === "duplicate" ? (
        <div className="mt-2 flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`duplicate-${version.id}`}>
            {t("versionNamePrompt")}
          </label>
          <input
            id={`duplicate-${version.id}`}
            autoFocus
            value={duplicateDraft}
            onChange={(event) => setDuplicateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setMode("idle");
            }}
            className="h-8 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-xs text-text outline-none focus:border-primary"
          />
          <button
            type="button"
            data-version-duplicate-submit={version.id}
            disabled={busy === "duplicate" || duplicateDraft.trim() === "" || otherRowBusy}
            onClick={() => {
              onDuplicate(duplicateDraft.trim());
              setMode("idle");
            }}
            className="h-8 shrink-0 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy === "duplicate" ? t("versionDuplicating") : t("versionCreateSubmit")}
          </button>
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="h-8 shrink-0 rounded-md border border-border px-2 text-[11px] text-text"
          >
            {t("versionCancel")}
          </button>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="mt-2 rounded-md border border-negative/30 bg-negative/5 p-2 text-[11px]" role="alertdialog" aria-label={t("versionConfirmDelete")}>
          <p className="font-medium text-negative">
            {locale === "ar" ? `حذف "${version.name}"؟` : `Delete “${version.name}”?`}
          </p>
          <p className="mt-1 text-muted">{t("versionDeleteConfirmBody")}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              data-version-delete-confirm={version.id}
              disabled={otherRowBusy}
              onClick={onDelete}
              className="h-8 rounded-md bg-negative px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {t("versionConfirmDelete")}
            </button>
            <button
              type="button"
              onClick={onCancelDeleteConfirm}
              className="h-8 rounded-md border border-border px-2.5 text-[11px] text-text"
            >
              {t("versionCancel")}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "idle" && !pendingDelete ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("versionActionsLabel")}>
          <button
            type="button"
            data-version-open={version.id}
            // حذف هذا الصفّ نفسه يُنهي حالة تأكيده فوراً (`onDelete` أعلاه)
            // بينما يبقى حذفه الفعلي في المتجَر معلَّقاً — فتحه في هذه الأثناء
            // يُحمِّل نسخةً قد لا تعود موجودة عند اكتمال الحذف، ويُبطل رمز
            // الطلب فلا يتعرّف حذفٌ لاحقٌ (`wasOpenAtStart` قِيست وقت بدئه لا
            // وقت الفتح) على أنه يجب إفراغ المحرِّر. عمداً بلا `otherRowBusy`:
            // تبديل النسخة لا يعتمد فتحة `versionBusy` المشتركة أصلاً، وفتح
            // نسخة أخرى بينما صفّ ثالث يُعاد تسميته أو يُكرَّر مدعومٌ ومُختبَر —
            // الخطر الحقيقي مقصور على حالة هذا الصفّ نفسه أعلاه.
            disabled={switching || busy === "delete"}
            onClick={onSelect}
            className="h-7 rounded-md border border-border px-2 text-[11px] font-medium text-text hover:bg-primary-soft disabled:opacity-50"
          >
            {switching ? t("versionSwitching") : openLabel}
          </button>
          {canDuplicate ? (
            <button
              type="button"
              data-version-duplicate={version.id}
              // `versionBusy` الأب فتحة مشتركة واحدة — بدء عملية هنا بينما صفّ
              // آخر مشغول يستبدلها بصمت فيُظهر ذلك الصفّ خاملاً رغم عمليته
              // الفعلية القائمة. `switching` يحرس هذا الصفّ نفسه: تبديله (GET)
              // قيد التنفيذ، وبدء كتابة عليه الآن قد تُنجَز قبل أن يستقرّ
              // الاختيار على مستند قد يتغيّر مصيره في هذه الأثناء. `busy` هنا
              // يحرس هذا الصفّ من *نفسه*: تقديم إعادة تسمية يُعيد `mode` فوراً
              // إلى "idle" (فيُظهر هذه الأزرار مجدداً) بينما طلبها لا يزال
              // معلَّقاً فعلياً — بدء عملية ثانية عليه الآن يستبدل الفتحة
              // المشتركة بنفسه.
              disabled={otherRowBusy || switching || busy !== null}
              onClick={() => {
                setDuplicateDraft(defaultDuplicateName(version.name, locale));
                setMode("duplicate");
              }}
              className="h-7 rounded-md border border-border px-2 text-[11px] font-medium text-text hover:bg-primary-soft disabled:opacity-50"
            >
              {duplicateLabel}
            </button>
          ) : null}
          {version.state !== "published" ? (
            <button
              type="button"
              data-version-rename={version.id}
              disabled={otherRowBusy || switching || busy !== null}
              onClick={() => {
                setNameDraft(version.name);
                setMode("rename");
              }}
              className="h-7 rounded-md border border-border px-2 text-[11px] font-medium text-text hover:bg-primary-soft disabled:opacity-50"
            >
              {t("versionRename")}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              data-version-delete={version.id}
              // نفس حراسة الأعلى: يمنع حذف صفّ لا يزال تبديله (فتحه) قيد
              // التنفيذ — حذفٌ ينجح بينما `GET`ـه لا يزال قادماً يترك المحرِّر
              // يفتح مستنداً حُذف للتو (راجع تعليق زرّ «فتح للتعديل» أعلاه)،
              // أو لا يزال لهذا الصفّ نفسه عمليةٌ أخرى معلَّقة فعلياً خلف
              // ظاهر "idle" (راجع تعليق زرّ التكرار أعلاه).
              disabled={otherRowBusy || switching || busy !== null}
              onClick={onOpenDeleteConfirm}
              className="h-7 rounded-md border border-border px-2 text-[11px] font-medium text-negative hover:bg-negative/10 disabled:opacity-50"
            >
              {t("versionDelete")}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
