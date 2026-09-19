"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clonePresentationConfig,
  DEFAULT_PRESENTATION_CONFIG,
  type HomeBuilderSectionKey,
  normalizePresentationConfig,
  presentationConfigsEqual,
  type StorefrontPresentationConfig,
} from "./presentation";
import {
  DRAFT_PERSISTENCE_CAPABILITY,
  PUBLISH_CAPABILITY,
  VERSION_HISTORY_CAPABILITY,
} from "./presentation/capabilities";
import {
  ControlPanels,
  CUSTOMIZER_NAV_GROUPS,
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
  const [selectedSection, setSelectedSection] =
    useState<HomeBuilderSectionKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingSectionScroll = useRef<HomeBuilderSectionKey | null>(null);
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  const dirty = !presentationConfigsEqual(draft, baseline);
  const activePanel = CUSTOMIZER_PANELS.find((item) => item.id === panel);

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

  // Section selection bridge (STORE-CUSTOMIZER-V2-1): a single selection
  // state shared by the sidebar composer and the live preview. Sidebar
  // selection opens the homepage panel and queues a scroll-to-section;
  // preview clicks only update the selection (the section is already in
  // view, so scrolling again would be a pointless jump).
  function handleSelectSection(
    key: HomeBuilderSectionKey,
    origin: "sidebar" | "preview",
  ) {
    setSelectedSection(key);
    // Both origins open the section's settings (Click-to-Edit foundation);
    // only sidebar selection needs the preview to scroll to the section,
    // since a preview click already has the section in view.
    setPanel("homepage");
    if (origin === "sidebar") {
      pendingSectionScroll.current = key;
    }
  }

  useEffect(() => {
    const key = pendingSectionScroll.current;
    if (!key) return;
    pendingSectionScroll.current = null;
    const root = rootRef.current;
    if (!root) return;
    const target = root.querySelector(`[data-preview-section="${key}"]`);
    if (!target || typeof target.scrollIntoView !== "function") return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [selectedSection]);

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
      ref={rootRef}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-experience-builder=""
      data-lifecycle={lifecycle}
      data-panel={panel}
      data-device={device}
      data-selected-section={selectedSection ?? ""}
      className="relative flex h-full min-h-0 flex-col bg-neutral-100 text-neutral-900"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3 md:h-12 md:gap-3 lg:pe-80">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-none md:text-sm">
            {t("title")}
          </p>
          <p className="mt-1 hidden truncate text-[11px] leading-none text-neutral-500 md:block">
            {t("subtitle")}
          </p>
        </div>
        <span
          data-draft-status=""
          className="hidden text-[11px] text-neutral-500 xl:inline"
        >
          {statusLabel}
        </span>
        <div className="flex items-center">
          {(["ar", "en"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-label={item === "ar" ? t("arabic") : t("english")}
              onClick={() => setLocale(item)}
              className={`h-7 min-w-7 px-1.5 text-[11px] font-medium ${
                locale === item
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {item === "ar" ? "ع" : "EN"}
            </button>
          ))}
        </div>
      </header>

      {notice ? (
        <div
          role="status"
          data-capability-notice=""
          className="shrink-0 border-b border-neutral-200 bg-white px-3 py-2 text-xs leading-5 text-neutral-700"
        >
          <span className="font-medium">{t("capabilityTitle")}. </span>
          {notice}
          {VERSION_HISTORY_CAPABILITY === "deferred"
            ? ` ${t("versionDeferred")}`
            : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t("controls")}
          data-customizer-scroll=""
          className={`${
            mobilePane === "preview" ? "hidden lg:flex" : "hidden md:flex"
          } w-[196px] shrink-0 flex-col overflow-y-auto border-e border-neutral-200 bg-white`}
        >
          <div className="flex flex-col py-2">
            {CUSTOMIZER_NAV_GROUPS.map((group, groupIndex) => (
              <div
                key={group.items.map((item) => item.id).join("-")}
                className={
                  groupIndex > 0
                    ? "mt-2 border-t border-neutral-200 pt-2"
                    : undefined
                }
              >
                {group.items.map((item) => {
                  const selected = panel === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-panel-option={item.id}
                      title={t(item.label)}
                      aria-current={selected ? "page" : undefined}
                      onClick={() => setPanel(item.id)}
                      className={`flex h-9 w-full items-center gap-2.5 px-3 text-start text-[13px] ${
                        selected
                          ? "bg-neutral-900 font-medium text-white"
                          : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                      }`}
                    >
                      <NavIcon panel={item.id} />
                      <span className="min-w-0 truncate">{t(item.label)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <aside
          data-builder-controls=""
          className={`${
            mobilePane === "edit" ? "flex" : "hidden"
          } w-full min-w-0 flex-col border-neutral-200 bg-white md:flex-1 lg:flex lg:w-[300px] lg:flex-none lg:border-e xl:w-[320px]`}
        >
          <div className="shrink-0 border-b border-neutral-200 px-3 py-2 md:hidden">
            <label className="sr-only" htmlFor="customizer-panel-select">
              {t("controls")}
            </label>
            <select
              id="customizer-panel-select"
              value={panel}
              onChange={(event) =>
                setPanel(event.target.value as CustomizerPanel)
              }
              className="h-11 w-full border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-800"
            >
              {CUSTOMIZER_PANELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden shrink-0 border-b border-neutral-200 px-4 py-3 md:block">
            <h2 className="text-[15px] font-semibold leading-tight">
              {activePanel ? t(activePanel.label) : t("theme")}
            </h2>
          </div>
          <div
            data-customizer-scroll=""
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5 lg:px-4 lg:py-5"
          >
            <ControlPanels
              panel={panel}
              config={draft}
              locale={locale}
              liveStoreName={liveStoreName}
              onChange={updateDraft}
              selectedSection={selectedSection}
              onSelectSection={(key) => handleSelectSection(key, "sidebar")}
            />
          </div>
        </aside>

        <section
          data-builder-preview=""
          aria-label={t("livePreview")}
          className={`${
            mobilePane === "preview" ? "flex" : "hidden"
          } min-w-0 flex-1 flex-col lg:flex`}
        >
          <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 bg-white px-3 text-[11px] text-neutral-500">
            <span className="font-medium text-neutral-700">
              {t("livePreview")}
            </span>
            <div className="flex items-center gap-2">
              <div className="hidden md:flex">
                {(["desktop", "tablet", "mobile"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-device-option={item}
                    onClick={() => setDevice(item)}
                    className={`h-7 px-2 text-[11px] font-medium ${
                      device === item
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    {t(item)}
                  </button>
                ))}
              </div>
              <span className="tabular-nums">
                {t("deviceWidth")} · {width}
              </span>
            </div>
          </div>
          <div
            data-customizer-scroll=""
            className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 md:p-5 xl:p-8"
          >
            <div
              data-preview-frame=""
              className="mx-auto overflow-hidden border border-neutral-300 bg-white"
              style={{ width: Math.min(width, 1440), maxWidth: "100%" }}
            >
              <StorefrontPreviewCanvas
                config={draft}
                locale={locale}
                viewport={device}
                liveStoreName={liveStoreName}
                selectedSection={selectedSection}
                onSelectSection={(key) => handleSelectSection(key, "preview")}
              />
            </div>
          </div>
        </section>
      </div>

      <div
        className={`${
          mobilePane === "preview" ? "hidden lg:flex" : "flex"
        } shrink-0 items-center gap-2 border-t border-neutral-200 bg-white px-3 py-2 lg:absolute lg:top-0 lg:end-3 lg:h-12 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0`}
      >
        <button
          type="button"
          onClick={handleRestore}
          className="hidden h-8 px-2 text-xs text-neutral-600 hover:text-neutral-900 lg:inline"
        >
          {t("restore")}
        </button>
        <button
          type="button"
          data-save=""
          onClick={handleSave}
          className="h-10 flex-1 border border-neutral-300 bg-white px-3 text-sm font-medium lg:h-8 lg:flex-none lg:px-2.5 lg:text-xs"
        >
          {t("save")}
        </button>
        <button
          type="button"
          data-publish=""
          onClick={handlePublish}
          className="h-10 flex-1 bg-neutral-900 px-3 text-sm font-medium text-white lg:h-8 lg:flex-none lg:px-2.5 lg:text-xs"
        >
          {t("publish")}
        </button>
      </div>

      <div className="flex h-11 shrink-0 border-t border-neutral-200 bg-white lg:hidden">
        <button
          type="button"
          className={`relative flex-1 text-sm font-medium ${mobilePane === "edit" ? "text-neutral-900" : "text-neutral-500"}`}
          onClick={() => setMobilePane("edit")}
        >
          {mobilePane === "edit" ? (
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-900" />
          ) : null}
          {t("edit")}
        </button>
        <button
          type="button"
          className={`relative flex-1 text-sm font-medium ${mobilePane === "preview" ? "text-neutral-900" : "text-neutral-500"}`}
          onClick={() => setMobilePane("preview")}
        >
          {mobilePane === "preview" ? (
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-900" />
          ) : null}
          {t("preview")}
        </button>
      </div>

      <span className="sr-only">
        {DRAFT_PERSISTENCE_CAPABILITY}:{PUBLISH_CAPABILITY}
      </span>
    </div>
  );
}

function NavIcon({ panel }: { panel: CustomizerPanel }) {
  const common = {
    viewBox: "0 0 16 16",
    className: "size-4 shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    "aria-hidden": true as const,
  };
  const icons: Record<CustomizerPanel, ReactNode> = {
    theme: (
      <svg {...common}>
        <circle cx="6" cy="6" r="2.25" />
        <circle cx="11" cy="5.5" r="1.75" />
        <circle cx="9.5" cy="11" r="2" />
      </svg>
    ),
    branding: (
      <svg {...common}>
        <path d="M3 13V5.5L8 3l5 2.5V13" />
        <path d="M8 7.5v5.5" />
      </svg>
    ),
    header: (
      <svg {...common}>
        <rect x="2.5" y="3" width="11" height="10" />
        <path d="M2.5 6.25h11" />
      </svg>
    ),
    homepage: (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="11" height="3" />
        <rect x="2.5" y="7" width="5" height="6.5" />
        <rect x="8.5" y="7" width="5" height="6.5" />
      </svg>
    ),
    footer: (
      <svg {...common}>
        <rect x="2.5" y="3" width="11" height="10" />
        <path d="M2.5 9.75h11" />
      </svg>
    ),
    contact: (
      <svg {...common}>
        <path d="M3 4.5h10v7H3z" />
        <path d="M3 4.5 8 8.25 13 4.5" />
      </svg>
    ),
    whatsapp: (
      <svg {...common}>
        <path d="M4 12.5 3.25 14 5.5 13A5.5 5.5 0 1 0 4 12.5Z" />
      </svg>
    ),
    social: (
      <svg {...common}>
        <circle cx="5" cy="8" r="2" />
        <circle cx="11.5" cy="4.5" r="1.75" />
        <circle cx="11.5" cy="11.5" r="1.75" />
        <path d="M6.7 7.1 9.8 5.3M6.7 8.9 9.8 10.7" />
      </svg>
    ),
    verification: (
      <svg {...common}>
        <path d="M8 2.5 13 4.5v4.2c0 3.1-2.2 4.9-5 5.8-2.8-.9-5-2.7-5-5.8V4.5L8 2.5Z" />
      </svg>
    ),
    apps: (
      <svg {...common}>
        <rect x="4" y="2.5" width="8" height="11" />
        <path d="M6.5 12.5h3" />
      </svg>
    ),
    pages: (
      <svg {...common}>
        <path d="M4.5 2.5h5.2L12.5 5.3V13.5H4.5z" />
        <path d="M9.5 2.5V5.5H12.5" />
      </svg>
    ),
  };
  return icons[panel];
}
