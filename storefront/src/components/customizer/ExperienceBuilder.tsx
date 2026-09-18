"use client";

import { useMemo, useState } from "react";
import {
  clonePresentationConfig,
  DEFAULT_PRESENTATION_CONFIG,
  normalizePresentationConfig,
  presentationConfigsEqual,
  type StorefrontPresentationConfig,
} from "@/lib/presentation";
import {
  DRAFT_PERSISTENCE_CAPABILITY,
  PUBLISH_CAPABILITY,
  VERSION_HISTORY_CAPABILITY,
} from "@/lib/presentation/capabilities";
import {
  ControlPanels,
  CUSTOMIZER_PANELS,
  type CustomizerPanel,
} from "./ControlPanels";
import {
  type CustomizerLocale,
  type CustomizerMessageKey,
  customizerMessage,
} from "./messages";
import { StorefrontPreviewCanvas } from "./StorefrontPreviewCanvas";

export const PREVIEW_WIDTHS = {
  mobile: 390,
  tablet: 768,
  desktop: 1280,
} as const;

export type PreviewDevice = keyof typeof PREVIEW_WIDTHS;

export type BuilderLifecycle =
  | "clean"
  | "dirty"
  | "save_blocked"
  | "publish_blocked";

interface ExperienceBuilderProps {
  initialConfig?: StorefrontPresentationConfig;
  liveStoreName?: string | null;
  initialLocale?: CustomizerLocale;
}

export function ExperienceBuilder({
  initialConfig,
  liveStoreName = null,
  initialLocale = "ar",
}: ExperienceBuilderProps) {
  const baseline = useMemo(
    () =>
      normalizePresentationConfig(initialConfig ?? DEFAULT_PRESENTATION_CONFIG),
    [initialConfig],
  );
  const [draft, setDraft] = useState<StorefrontPresentationConfig>(baseline);
  const [locale, setLocale] = useState<CustomizerLocale>(initialLocale);
  const [panel, setPanel] = useState<CustomizerPanel>("theme");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [mobilePane, setMobilePane] = useState<"edit" | "preview">("edit");
  const [lifecycle, setLifecycle] = useState<BuilderLifecycle>("clean");
  const [notice, setNotice] = useState<string | null>(null);
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  const dirty = !presentationConfigsEqual(draft, baseline);

  function updateDraft(next: StorefrontPresentationConfig) {
    const normalized = normalizePresentationConfig(next);
    setDraft(normalized);
    setLifecycle("dirty");
    setNotice(null);
  }

  function handleSave() {
    setLifecycle("save_blocked");
    setNotice(t("saveBlocked"));
  }

  function handlePublish() {
    setLifecycle("publish_blocked");
    setNotice(t("publishBlocked"));
  }

  function handleRestore() {
    const confirmed = window.confirm(t("restoreConfirm"));
    if (!confirmed) return;
    setDraft(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
    setLifecycle("dirty");
    setNotice(null);
  }

  const width = PREVIEW_WIDTHS[device];
  const statusLabel =
    lifecycle === "save_blocked"
      ? t("save")
      : lifecycle === "publish_blocked"
        ? t("publish")
        : dirty
          ? t("dirty")
          : t("clean");

  return (
    <div
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-experience-builder=""
      data-lifecycle={lifecycle}
      data-panel={panel}
      data-device={device}
      className="flex h-full min-h-0 flex-col bg-neutral-200 text-neutral-900"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-300 bg-white px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-none">
            {t("title")}
          </p>
          <p className="mt-1 hidden truncate text-[11px] text-neutral-500 md:block">
            {t("subtitle")}
          </p>
        </div>
        <span
          data-draft-status=""
          className="hidden rounded border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 sm:inline"
        >
          {statusLabel}
        </span>
        <div className="ms-auto flex items-center gap-1">
          <div className="hidden rounded border border-neutral-300 p-0.5 md:flex">
            {(["desktop", "tablet", "mobile"] as const).map((item) => (
              <button
                key={item}
                type="button"
                data-device-option={item}
                onClick={() => setDevice(item)}
                className={`h-7 px-2 text-[11px] font-medium ${
                  device === item
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-700"
                }`}
              >
                {t(item)}
              </button>
            ))}
          </div>
          <div className="flex rounded border border-neutral-300 p-0.5">
            {(["ar", "en"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setLocale(item)}
                className={`h-7 px-2 text-[11px] font-medium ${
                  locale === item
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-700"
                }`}
              >
                {item === "ar" ? t("arabic") : t("english")}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleRestore}
            className="hidden h-8 rounded border border-neutral-300 px-2 text-xs md:inline"
          >
            {t("restore")}
          </button>
          <button
            type="button"
            data-save=""
            onClick={handleSave}
            className="h-8 rounded border border-neutral-300 bg-white px-2.5 text-xs font-medium"
          >
            {t("save")}
          </button>
          <button
            type="button"
            data-publish=""
            onClick={handlePublish}
            className="h-8 rounded bg-neutral-900 px-2.5 text-xs font-medium text-white"
          >
            {t("publish")}
          </button>
        </div>
      </header>

      {notice ? (
        <div
          role="status"
          data-capability-notice=""
          className="shrink-0 border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-700"
        >
          <span className="font-medium">{t("capabilityTitle")}. </span>
          {notice}
          {VERSION_HISTORY_CAPABILITY === "deferred"
            ? ` ${t("versionDeferred")}`
            : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          data-builder-controls=""
          className={`${
            mobilePane === "edit" ? "flex" : "hidden"
          } w-full shrink-0 flex-col border-neutral-300 bg-white md:flex md:w-[360px] md:border-e`}
        >
          <nav
            aria-label={t("controls")}
            className="flex gap-1 overflow-x-auto border-b border-neutral-200 px-2 py-2 md:flex-col md:overflow-y-auto md:overflow-x-hidden"
          >
            {CUSTOMIZER_PANELS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-panel-option={item.id}
                onClick={() => setPanel(item.id)}
                className={`h-8 shrink-0 rounded px-2 text-start text-xs font-medium md:h-8 ${
                  panel === item.id
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                {t(item.label)}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ControlPanels
              panel={panel}
              config={draft}
              locale={locale}
              liveStoreName={liveStoreName}
              onChange={updateDraft}
            />
          </div>
        </aside>

        <section
          data-builder-preview=""
          aria-label={t("livePreview")}
          className={`${
            mobilePane === "preview" ? "flex" : "hidden"
          } min-w-0 flex-1 flex-col md:flex`}
        >
          <div className="flex items-center justify-between border-b border-neutral-300 bg-neutral-100 px-3 py-1.5 text-[11px] text-neutral-600">
            <span>{t("livePreview")}</span>
            <span>
              {t("deviceWidth")} · {width}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
            <div
              data-preview-frame=""
              className="mx-auto overflow-hidden rounded-md border border-neutral-400 bg-white shadow-sm"
              style={{ width: Math.min(width, 1440), maxWidth: "100%" }}
            >
              <StorefrontPreviewCanvas
                config={draft}
                locale={locale}
                viewport={device}
                liveStoreName={liveStoreName}
              />
            </div>
          </div>
        </section>
      </div>

      <div className="flex h-12 shrink-0 border-t border-neutral-300 bg-white md:hidden">
        <button
          type="button"
          className={`flex-1 text-sm font-medium ${mobilePane === "edit" ? "text-neutral-900" : "text-neutral-500"}`}
          onClick={() => setMobilePane("edit")}
        >
          {t("edit")}
        </button>
        <button
          type="button"
          className={`flex-1 text-sm font-medium ${mobilePane === "preview" ? "text-neutral-900" : "text-neutral-500"}`}
          onClick={() => setMobilePane("preview")}
        >
          {t("preview")}
        </button>
      </div>

      <span className="sr-only">
        {DRAFT_PERSISTENCE_CAPABILITY}:{PUBLISH_CAPABILITY}
      </span>
    </div>
  );
}
