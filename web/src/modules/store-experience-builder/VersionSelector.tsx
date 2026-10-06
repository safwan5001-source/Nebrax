"use client";

/**
 * CUST-H1-2 — مؤشّر النسخة في الشريط العلوي، منفصل بصرياً ودلالياً عن أي
 * مُنتقي صفحة مستقبلي: يجيب «أي نسخة تصميم أُعدِّل؟» لا «أي صفحة أعرض؟».
 * سطح المكتب فقط (Popover)؛ الجوال يستخدم Bottom Sheet من `ExperienceBuilder`
 * مباشرة بنفس لوحة `VersionManagerPanel` لتفادي ازدواج المنطق.
 */

import { Dropdown } from "@/components/ui/dropdown";
import type { PresentationVersionState } from "@/modules/commerce-workspace/presentation-versions";
import { type CustomizerLocale, customizerMessage } from "./messages";
import { VersionManagerPanel, type VersionManagerPanelProps } from "./VersionManagerPanel";

function stateLabel(
  state: PresentationVersionState | null,
  locale: CustomizerLocale,
): string {
  if (state === "published") return customizerMessage(locale, "versionStatePublished");
  if (state === "scheduled") return customizerMessage(locale, "versionStateScheduled");
  if (state === "draft") return customizerMessage(locale, "versionStateDraft");
  return "";
}

export function VersionSelector({
  locale,
  currentName,
  currentState,
  loading,
  panelProps,
}: {
  locale: CustomizerLocale;
  currentName: string | null;
  currentState: PresentationVersionState | null;
  loading: boolean;
  panelProps: VersionManagerPanelProps;
}) {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage(locale, key);
  const label = loading
    ? t("versionSwitching")
    : currentName
      ? currentName
      : t("versionNoVersionSelected");

  return (
    <Dropdown
      align="start"
      menuLabel={t("versionManagerTitle")}
      triggerLabel={t("versionSelectorLabel")}
      triggerClassName="h-9 min-w-0 max-w-[84px] gap-1.5 border-s border-border ps-3 text-xs text-text hover:bg-primary-soft hover:text-primary md:max-w-[148px] md:text-sm lg:max-w-[220px]"
      // `mobilePopover` يُثبَّت هنا رغم أن هذا المكوّن سطح مكتب فقط (الجوال
      // الحقيقي يستخدم Bottom Sheet منفصلاً): بلا هذا، اللوحة تتموضع بـ
      // `absolute` مطلقة العرض (حتى 24rem) بلا احتواء داخل الشاشة، فتُفيض
      // أفقياً على الأجهزة اللوحية (768px) حيث الزر ليس عند حافة الشريط.
      mobilePopover
      menuClassName="w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] flex flex-col p-2"
      trigger={
        <span data-version-selector="" className="flex min-w-0 items-center gap-1.5">
          <VersionSelectorIcon />
          <span className="min-w-0 truncate font-medium">
            <bdi>{label}</bdi>
          </span>
          {currentState ? (
            <span
              data-version-selector-state=""
              className="hidden shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary lg:inline"
            >
              {stateLabel(currentState, locale)}
            </span>
          ) : null}
          <ChevronIcon />
        </span>
      }
    >
      {({ close }) => (
        <VersionManagerPanel
          {...panelProps}
          onSelect={(version) => {
            panelProps.onSelect(version);
            close();
          }}
        />
      )}
    </Dropdown>
  );
}

function VersionSelectorIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <rect x="2.5" y="2.5" width="8" height="8" rx="1" />
      <path d="M5.5 5.5h8v8h-8z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
