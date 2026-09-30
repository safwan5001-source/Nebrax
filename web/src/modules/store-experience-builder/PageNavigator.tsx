"use client";

/**
 * CUST-H2-2 — منتقي الصفحة في الشريط العلوي، منفصل بصرياً ودلالياً عن
 * `VersionSelector`: يجيب «أي صفحة متجر أعاين؟» لا «أي نسخة تصميم أُعدِّل؟»
 * (التمييز نفسه الذي علّق عليه `VersionSelector.tsx` مسبقاً). سطح المكتب/
 * الجهاز اللوحي فقط (Popover) — الجوال يستخدم ورقة سفلية مستقلة من
 * `ExperienceBuilder` مباشرة، بنفس `PageNavigatorPanel` لتفادي ازدواج المنطق،
 * تماماً كنظيرتها في منتقي النسخة.
 */

import { useRef } from "react";
import { Dropdown } from "@/components/ui/dropdown";
import type { PageType } from "./presentation";
import { type CustomizerLocale, customizerMessage } from "./messages";
import { PageIcon, PageNavigatorPanel, pageLabelKey } from "./PageNavigatorPanel";

export function PageNavigator({
  locale,
  currentPage,
  onSelect,
}: {
  locale: CustomizerLocale;
  currentPage: PageType;
  onSelect: (page: PageType) => void;
}) {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage(locale, key);
  // `Dropdown.close()` never re-focuses the trigger on its own (only its
  // internal Escape handler does) — the same gap `VersionSelector` already
  // carries. Reusing an external `triggerButtonRef` (a prop `Dropdown`
  // already supports) lets this control satisfy the accessibility
  // requirement itself, without changing the shared component's behavior
  // for any other Dropdown consumer.
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Dropdown
      align="start"
      menuLabel={t("pageNavigatorMenuTitle")}
      triggerLabel={t("pageNavigatorSelectorLabel")}
      triggerButtonRef={triggerRef}
      triggerClassName="h-7 min-w-0 max-w-[150px] gap-1 rounded-md px-1.5 text-[11px] text-muted hover:bg-primary-soft hover:text-primary"
      mobilePopover
      menuClassName="w-[min(16rem,calc(100vw-2rem))] p-2"
      trigger={
        <span data-page-navigator="" className="flex min-w-0 items-center gap-1">
          <PageIcon page={currentPage} />
          {/* Tablet (768–1023) has zero toolbar-width slack left for a
              variable-length label (confirmed: even the shortest page name
              already left the Publish button at the very edge) — icon +
              accessible name only there, matching the task's own "shorten
              labels; use icon + accessible name" tablet guidance. The full
              label returns once there is real room, at `lg` (1024px). */}
          <span className="hidden min-w-0 truncate font-medium lg:inline">
            <bdi>{t(pageLabelKey(currentPage))}</bdi>
          </span>
          <ChevronIcon />
        </span>
      }
    >
      {({ close }) => (
        <PageNavigatorPanel
          locale={locale}
          currentPage={currentPage}
          onSelect={(page) => {
            onSelect(page);
            close();
            triggerRef.current?.focus();
          }}
        />
      )}
    </Dropdown>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
