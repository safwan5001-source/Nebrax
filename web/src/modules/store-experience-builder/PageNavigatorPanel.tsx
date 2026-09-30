"use client";

/**
 * CUST-H2-2 — قائمة اختيار الصفحة، معاد استعمالها من موضعين بالضبط كما
 * `VersionManagerPanel`: داخل قائمة `PageNavigator` المنسدلة على سطح المكتب/
 * الجهاز اللوحي، وداخل ورقة سفلية مستقلة على الجوال (`ExperienceBuilder`).
 * منطق واحد لا نسختان، بنفس انضباط منتقي النسخة.
 *
 * الاختيار حالة محرِّر بحتة — لا شبكة، لا حفظ، لا تغيير حالة "مسودة" — راجع
 * `ExperienceBuilder.handleSelectPage`.
 */

import type { PageType } from "./presentation";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "./messages";

export const PAGE_ORDER: readonly PageType[] = ["home", "product", "category"];

const PAGE_LABEL_KEY: Record<PageType, CustomizerMessageKey> = {
  home: "pageHome",
  product: "pageProduct",
  category: "pageCategory",
};

export function pageLabelKey(page: PageType): CustomizerMessageKey {
  return PAGE_LABEL_KEY[page];
}

export function PageNavigatorPanel({
  locale,
  currentPage,
  onSelect,
}: {
  locale: CustomizerLocale;
  currentPage: PageType;
  onSelect: (page: PageType) => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  return (
    <div data-page-navigator-panel="" role="group" aria-label={t("pageNavigatorMenuTitle")} className="flex flex-col gap-0.5">
      {PAGE_ORDER.map((page) => {
        const selected = page === currentPage;
        return (
          <button
            key={page}
            type="button"
            data-page-option={page}
            aria-current={selected ? "page" : undefined}
            onClick={() => onSelect(page)}
            className={`flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-start text-sm ${
              selected
                ? "bg-primary-soft font-medium text-primary"
                : "text-text hover:bg-primary-soft"
            }`}
          >
            <PageIcon page={page} />
            <span className="min-w-0 flex-1 truncate">{t(pageLabelKey(page))}</span>
            {selected ? <SelectedCheckIcon /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function PageIcon({ page }: { page: PageType }) {
  const common = {
    viewBox: "0 0 16 16",
    className: "size-4 shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    "aria-hidden": true as const,
  };
  if (page === "product") {
    return (
      <svg {...common}>
        <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11z" />
        <path d="M2.5 5 8 7.5 13.5 5M8 7.5v6" />
      </svg>
    );
  }
  if (page === "category") {
    return (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="4.75" height="4.75" />
        <rect x="8.75" y="2.5" width="4.75" height="4.75" />
        <rect x="2.5" y="8.75" width="4.75" height="4.75" />
        <rect x="8.75" y="8.75" width="4.75" height="4.75" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M2.5 7.5 8 3l5.5 4.5V13H9.5V9.5h-3V13H2.5Z" />
    </svg>
  );
}

function SelectedCheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}
