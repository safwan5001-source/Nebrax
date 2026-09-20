"use client";

import {
  ArrowLeft,
  ArrowRight,
  Eye,
  Monitor,
  RotateCcw,
  Save,
  Smartphone,
  Tablet,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  const [locale] = useState<CustomizerLocale>(initialLocale);
  const [panel, setPanel] = useState<CustomizerPanel>("theme");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [mobileSheet, setMobileSheet] = useState<"sections" | "design" | null>(
    null,
  );
  const [lifecycle, setLifecycle] = useState<BuilderLifecycle>("clean");
  const [notice, setNotice] = useState<string | null>(null);
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
      className="awj-editor relative flex h-full min-h-0 flex-col bg-awj-editor-background text-awj-editor-foreground"
    >
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-awj-editor-border bg-awj-editor-surface px-3 md:gap-3 lg:px-4">
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-awj-editor-border bg-awj-editor-surface px-2 text-xs font-medium text-awj-editor-foreground-muted hover:bg-awj-editor-surface-muted hover:text-awj-editor-foreground"
          onClick={() => window.history.back()}
        >
          {locale === "ar" ? (
            <ArrowRight className="size-3.5" aria-hidden />
          ) : (
            <ArrowLeft className="size-3.5" aria-hidden />
          )}
          <span className="hidden sm:inline">{t("exitCommerce")}</span>
        </button>
        <div className="min-w-0 flex-1 border-s-2 border-awj-editor-primary ps-3">
          <p className="truncate text-[13px] font-semibold leading-none md:text-sm">
            {t("title")}
          </p>
          <p className="mt-1 hidden truncate text-[11px] leading-none text-awj-editor-muted md:block">
            {t("subtitle")}
          </p>
        </div>
        <span data-draft-status="" className="hidden text-[11px] xl:inline">
          {statusLabel}
        </span>
      </header>

      {notice ? (
        <div
          role="status"
          data-capability-notice=""
          className="shrink-0 border-b border-awj-editor-border bg-awj-editor-surface px-3 py-2 text-xs leading-5 text-awj-editor-foreground-muted"
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
          className={`${"hidden lg:flex"} w-[196px] shrink-0 flex-col overflow-y-auto border-e border-awj-editor-border bg-awj-editor-surface`}
        >
          <div className="flex flex-col py-2">
            {CUSTOMIZER_NAV_GROUPS.map((group, groupIndex) => (
              <div
                key={group.items.map((item) => item.id).join("-")}
                className={
                  groupIndex > 0
                    ? "mt-2 border-t border-awj-editor-border pt-2"
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
                          ? "bg-awj-editor-primary font-medium text-awj-editor-primary-foreground"
                          : "text-awj-editor-foreground-muted hover:bg-awj-editor-surface-muted hover:text-awj-editor-foreground"
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
          className={`${"hidden lg:flex"} w-full min-w-0 flex-col border-awj-editor-border bg-awj-editor-surface md:flex-1 lg:flex lg:w-[300px] lg:flex-none lg:border-e xl:w-[320px]`}
        >
          <div className="shrink-0 border-b border-awj-editor-border px-3 py-2 md:hidden">
            <label className="sr-only" htmlFor="customizer-panel-select">
              {t("controls")}
            </label>
            <select
              id="customizer-panel-select"
              value={panel}
              onChange={(event) =>
                setPanel(event.target.value as CustomizerPanel)
              }
              className="h-11 w-full border border-awj-editor-border-strong bg-awj-editor-surface px-3 text-sm font-medium text-awj-editor-foreground outline-none focus:border-awj-editor-ring"
            >
              {CUSTOMIZER_PANELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden shrink-0 border-b border-awj-editor-border px-4 py-3 md:block">
            <h2 className="text-[15px] font-semibold leading-tight">
              {activePanel ? t(activePanel.label) : t("theme")}
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5 lg:px-4 lg:py-5">
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
          className={`${"flex"} min-w-0 flex-1 flex-col lg:flex`}
        >
          <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-awj-editor-border bg-awj-editor-surface px-3 text-[11px] text-awj-editor-muted">
            <span className="inline-flex items-center gap-1.5 font-medium text-awj-editor-foreground">
              <Eye className="size-3.5" aria-hidden />
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
                    aria-pressed={device === item}
                    className={`inline-flex h-8 items-center gap-1.5 border-s border-awj-editor-border px-2 text-[11px] font-medium first:border-s-0 ${
                      device === item
                        ? "bg-awj-editor-primary-soft text-awj-editor-primary"
                        : "text-awj-editor-foreground-muted hover:bg-awj-editor-surface-muted"
                    }`}
                  >
                    {item === "desktop" ? (
                      <Monitor className="size-3.5" aria-hidden />
                    ) : item === "tablet" ? (
                      <Tablet className="size-3.5" aria-hidden />
                    ) : (
                      <Smartphone className="size-3.5" aria-hidden />
                    )}
                    {t(item)}
                  </button>
                ))}
              </div>
              <span className="tabular-nums">
                {t("deviceWidth")} · {width}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5 xl:p-8">
            <div
              data-preview-frame=""
              className="mx-auto overflow-hidden border border-awj-editor-border-strong bg-awj-editor-surface"
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

      <div
        className={`${"hidden lg:flex"} shrink-0 items-center gap-2 border-t border-awj-editor-border bg-awj-editor-surface px-3 py-2 lg:absolute lg:top-0 lg:end-3 lg:h-12 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0`}
      >
        <button
          type="button"
          onClick={handleRestore}
          className="hidden h-8 items-center gap-1.5 px-2 text-xs text-awj-editor-foreground-muted hover:text-awj-editor-foreground lg:inline-flex"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          {t("restore")}
        </button>
        <button
          type="button"
          data-save=""
          onClick={handleSave}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-awj-editor-border-strong bg-awj-editor-surface px-3 text-sm font-medium hover:bg-awj-editor-surface-muted lg:h-8 lg:flex-none lg:px-2.5 lg:text-xs"
        >
          <Save className="size-3.5" aria-hidden />
          {t("save")}
        </button>
        <button
          type="button"
          data-publish=""
          onClick={handlePublish}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-awj-editor-primary px-3 text-sm font-medium text-awj-editor-primary-foreground hover:opacity-90 lg:h-8 lg:flex-none lg:px-2.5 lg:text-xs"
        >
          <Upload className="size-3.5" aria-hidden />
          {t("publish")}
        </button>
      </div>

      <div className="relative z-50 flex h-16 shrink-0 items-center gap-2 border-t border-awj-editor-border bg-awj-editor-surface px-3 lg:hidden">
        <button
          type="button"
          className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-awj-editor-border px-2 text-sm font-medium text-awj-editor-foreground hover:bg-awj-editor-primary-soft focus-visible:outline-none"
          onClick={() => setMobileSheet("sections")}
        >
          {t("sections")}
        </button>
        <button
          type="button"
          className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-awj-editor-primary px-2 text-sm font-medium text-awj-editor-primary-foreground hover:opacity-90 focus-visible:outline-none"
          onClick={() => setMobileSheet("sections")}
        >
          + {t("addSection")}
        </button>
        <button
          type="button"
          className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-awj-editor-border px-2 text-sm font-medium text-awj-editor-foreground hover:bg-awj-editor-primary-soft focus-visible:outline-none"
          onClick={() => setMobileSheet("design")}
        >
          {t("design")}
        </button>
      </div>

      <Sheet
        open={mobileSheet !== null}
        onOpenChange={(open) => !open && setMobileSheet(null)}
      >
        <SheetContent
          side="bottom"
          className="max-h-[86dvh] overflow-hidden rounded-t-xl border-awj-editor-border bg-awj-editor-surface p-0 lg:hidden"
        >
          <SheetHeader className="shrink-0 border-b border-awj-editor-border px-4 py-3">
            <SheetTitle className="text-start text-sm text-awj-editor-foreground">
              {mobileSheet === "design" ? t("design") : t("sections")}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto px-4 py-4">
            <ControlPanels
              panel={mobileSheet === "design" ? "theme" : "homepage"}
              config={draft}
              locale={locale}
              liveStoreName={liveStoreName}
              onChange={updateDraft}
            />
          </div>
        </SheetContent>
      </Sheet>

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
