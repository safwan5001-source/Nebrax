"use client";

import { useState } from "react";
import { inputClass } from "./ControlPanels";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "./messages";
import { PolicyMarkdownPreview } from "./PolicyMarkdownPreview";
import {
  POLICY_BODY_MAX,
  POLICY_LOCALES,
  POLICY_TITLE_MAX,
  type PolicyLocale,
  charCount,
  policyLocaleContent,
  policyStatus,
  withPolicyField,
} from "./policy-edit";
import { fillTemplate } from "./slider-edit";
import type { PresentationContentPage } from "./presentation/config";

const STATUS_KEY: Record<ReturnType<typeof policyStatus>, CustomizerMessageKey> = {
  hidden: "policyStatusHidden",
  empty: "policyStatusEmpty",
  ready: "policyStatusReady",
};

const STATUS_CLASS: Record<ReturnType<typeof policyStatus>, string> = {
  hidden: "bg-neutral-100 text-neutral-600",
  empty: "bg-amber-50 text-amber-800",
  ready: "bg-emerald-50 text-emerald-800",
};

/**
 * B8-3 — Markdown editor for one policy page's localized `content` (B8-1 contract). Edits flow through
 * the Customizer's normal `patch({ pages })`, so dirty-state, save/publish, versions and rollback are
 * the existing machinery. 16px inputs avoid iOS zoom; 44px targets for touch.
 */
export function PolicyEditor({
  page,
  uiLocale,
  onChange,
}: {
  page: PresentationContentPage;
  uiLocale: CustomizerLocale;
  onChange: (next: PresentationContentPage) => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(uiLocale, key);
  const [lang, setLang] = useState<PolicyLocale>(uiLocale === "en" ? "en" : "ar");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const status = policyStatus(page);
  const { title, body } = policyLocaleContent(page, lang);
  const dir = lang === "ar" ? "rtl" : "ltr";
  const titleCount = charCount(title);
  const bodyCount = charCount(body);
  const titleOver = titleCount - POLICY_TITLE_MAX;
  const bodyOver = bodyCount - POLICY_BODY_MAX;
  const tabClass = (active: boolean) =>
    `min-h-11 flex-1 px-3 text-[13px] font-medium ${
      active ? "bg-primary text-primary-foreground" : "text-neutral-600 hover:bg-primary-soft"
    }`;
  const idBase = `policy-${page.id}-${lang}`;

  return (
    <div className="space-y-3 border-t border-neutral-200 pt-3" data-testid={`policy-editor-${page.slug}`}>
      <p
        data-testid="policy-status"
        data-status={status}
        className={`px-2 py-1.5 text-[12px] leading-5 ${STATUS_CLASS[status]}`}
      >
        {t(STATUS_KEY[status])}
      </p>

      <div className="flex border border-neutral-300 p-0.5" role="group" aria-label={t("policyLangGroup")}>
        {POLICY_LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={tabClass(lang === l)}
          >
            {t(l === "ar" ? "arabic" : "english")}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <label htmlFor={`${idBase}-title`} className="text-[12px] font-medium text-neutral-700">
          {t("policyTitleLabel")}
        </label>
        <input
          id={`${idBase}-title`}
          dir={dir}
          lang={lang}
          className={`${inputClass} !h-11 !text-base sm:!text-sm ${titleOver > 0 ? "!border-red-600" : ""}`}
          value={title}
          aria-invalid={titleOver > 0}
          aria-describedby={`${idBase}-title-meta`}
          onChange={(event) => onChange(withPolicyField(page, lang, "title", event.target.value))}
        />
        <div id={`${idBase}-title-meta`} className="flex justify-between gap-2 text-[11px]">
          <span role={titleOver > 0 ? "alert" : undefined} className="text-red-700">
            {titleOver > 0 ? fillTemplate(t("policyOverBy"), { n: titleOver }) : ""}
          </span>
          <span className={titleOver > 0 ? "text-red-700" : "text-neutral-500"} dir="ltr">
            {titleCount} / {POLICY_TITLE_MAX}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${idBase}-body`} className="text-[12px] font-medium text-neutral-700">
            {t("policyBodyLabel")}
          </label>
          <div className="flex border border-neutral-300 p-0.5">
            <button
              type="button"
              aria-pressed={mode === "edit"}
              onClick={() => setMode("edit")}
              className={`${tabClass(mode === "edit")} flex-none`}
            >
              {t("policyModeEdit")}
            </button>
            <button
              type="button"
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
              className={`${tabClass(mode === "preview")} flex-none`}
            >
              {t("policyModePreview")}
            </button>
          </div>
        </div>

        {mode === "edit" ? (
          <>
            <textarea
              id={`${idBase}-body`}
              dir={dir}
              lang={lang}
              rows={12}
              className={`${inputClass} !h-auto min-h-48 !py-2 !text-base leading-6 sm:!text-sm ${bodyOver > 0 ? "!border-red-600" : ""}`}
              value={body}
              aria-invalid={bodyOver > 0}
              aria-describedby={`${idBase}-body-meta`}
              onChange={(event) => onChange(withPolicyField(page, lang, "body", event.target.value))}
            />
            <p className="text-[11px] leading-5 text-neutral-500">{t("policyMarkdownHint")}</p>
          </>
        ) : (
          <div
            dir={dir}
            lang={lang}
            className="max-h-96 min-h-24 overflow-y-auto border border-neutral-200 bg-white p-3 text-sm leading-6 text-neutral-900 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:ps-5"
          >
            {body.trim() === "" ? (
              <p className="text-neutral-500">{t("policyPreviewEmpty")}</p>
            ) : (
              <PolicyMarkdownPreview markdown={body} />
            )}
          </div>
        )}
        <div id={`${idBase}-body-meta`} className="flex justify-between gap-2 text-[11px]">
          <span role={bodyOver > 0 ? "alert" : undefined} className="text-red-700">
            {bodyOver > 0 ? fillTemplate(t("policyOverBy"), { n: bodyOver }) : ""}
          </span>
          <span className={bodyOver > 0 ? "text-red-700" : "text-neutral-500"} dir="ltr">
            {bodyCount.toLocaleString("en-US")} / {POLICY_BODY_MAX.toLocaleString("en-US")}
          </span>
        </div>
        {mode === "preview" ? (
          <p className="text-[11px] leading-5 text-neutral-500">{t("policyPreviewNote")}</p>
        ) : null}
      </div>
    </div>
  );
}
