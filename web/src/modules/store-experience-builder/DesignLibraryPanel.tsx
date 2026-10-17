"use client";

import { useMemo, useState } from "react";
import {
  canAddSectionType,
  newHomeSectionId,
  type PresentationHomeSection,
  type StorefrontPresentationConfig,
} from "./presentation";
import {
  DESIGN_LIBRARY_CATEGORIES,
  DESIGN_LIBRARY_VARIANTS,
  type DesignLibraryCategory,
  type DesignLibraryVariant,
  type SectionDesignLibraryVariant,
} from "./design-library";
import {
  customizerMessage,
  type CustomizerLocale,
  type CustomizerMessageKey,
} from "./messages";

type CategoryFilter = DesignLibraryCategory | "all";

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function targetSection(
  config: StorefrontPresentationConfig,
  variant: SectionDesignLibraryVariant,
  selectedSection: string | null,
): PresentationHomeSection | undefined {
  const sections = config.homepage.sections;
  return (
    sections.find(
      (section) =>
        section.id === selectedSection && section.type === variant.sectionType,
    ) ?? sections.find((section) => section.type === variant.sectionType)
  );
}

export function DesignLibraryPanel({
  config,
  locale,
  selectedSection,
  onChange,
  onSelectSection,
}: {
  config: StorefrontPresentationConfig;
  locale: CustomizerLocale;
  selectedSection: string | null;
  onChange: (next: StorefrontPresentationConfig) => void;
  onSelectSection?: (id: string | null) => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const language = locale === "en" ? "en" : "ar";
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const normalizedSearch = search.trim().toLocaleLowerCase();

  const variants = useMemo(
    () =>
      DESIGN_LIBRARY_VARIANTS.filter((variant) => {
        if (category !== "all" && variant.category !== category) return false;
        if (!normalizedSearch) return true;
        return `${variant.name[language]} ${variant.description[language]}`
          .toLocaleLowerCase()
          .includes(normalizedSearch);
      }),
    [category, language, normalizedSearch],
  );

  const addSection = (variant: SectionDesignLibraryVariant) => {
    if (!canAddSectionType(config.homepage.sections, variant.sectionType)) {
      return;
    }
    const id = newHomeSectionId();
    onChange({
      ...config,
      homepage: {
        ...config.homepage,
        sections: [
          ...config.homepage.sections,
          {
            id,
            type: variant.sectionType,
            visible: true,
            design: { ...variant.design },
          },
        ],
      },
    });
    onSelectSection?.(id);
  };

  const apply = (variant: DesignLibraryVariant) => {
    if (variant.scope === "global") {
      onChange({
        ...config,
        productCard: variant.productCard,
        cards: { ...variant.cards },
      });
      return;
    }

    const target = targetSection(config, variant, selectedSection);
    if (target) {
      onChange({
        ...config,
        homepage: {
          ...config.homepage,
          sections: config.homepage.sections.map((section) =>
            section.id === target.id
              ? { ...section, visible: true, design: { ...variant.design } }
              : section,
          ),
        },
      });
      onSelectSection?.(target.id);
      return;
    }

    addSection(variant);
  };

  const restoreDefault = (variant: DesignLibraryVariant) => {
    if (variant.scope === "global") {
      const { cards: _cards, ...withoutCards } = config;
      onChange({ ...withoutCards, productCard: "standard" });
      return;
    }
    const target = targetSection(config, variant, selectedSection);
    if (!target) return;
    const { design: _design, ...withoutDesign } = target;
    onChange({
      ...config,
      homepage: {
        ...config.homepage,
        sections: config.homepage.sections.map((section) =>
          section.id === target.id ? withoutDesign : section,
        ),
      },
    });
    onSelectSection?.(target.id);
  };

  return (
    <div data-design-library="" className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-text">
          {t("designLibraryTitle")}
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          {t("designLibraryHint")}
        </p>
      </div>

      <label className="block">
        <span className="sr-only">{t("designLibrarySearchLabel")}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("designLibrarySearchPlaceholder")}
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none placeholder:text-muted focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      </label>

      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="group"
        aria-label={t("designLibraryCategoryLabel")}
      >
        <FilterChip
          label={t("designLibraryAll")}
          active={category === "all"}
          onClick={() => setCategory("all")}
        />
        {DESIGN_LIBRARY_CATEGORIES.map((value) => (
          <FilterChip
            key={value}
            label={t(DESIGN_CATEGORY_MESSAGE[value])}
            active={category === value}
            onClick={() => setCategory(value)}
          />
        ))}
      </div>

      {variants.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted">
          {t("designLibraryEmpty")}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {variants.map((variant) => {
            const target =
              variant.scope === "section"
                ? targetSection(config, variant, selectedSection)
                : undefined;
            const active =
              variant.scope === "global"
                ? config.productCard === variant.productCard &&
                  sameValue(config.cards, variant.cards)
                : target
                  ? sameValue(target.design, variant.design)
                  : false;
            const canAdd =
              variant.scope === "section" && !target
                ? canAddSectionType(
                    config.homepage.sections,
                    variant.sectionType,
                  )
                : true;
            const canAddAnother =
              variant.scope === "section" && target
                ? canAddSectionType(
                    config.homepage.sections,
                    variant.sectionType,
                  )
                : false;
            const canRestore =
              variant.scope === "global"
                ? config.productCard !== "standard" || config.cards !== undefined
                : target?.design !== undefined;

            return (
              <li
                key={variant.id}
                data-design-library-variant={variant.id}
                className={`overflow-hidden rounded-lg border bg-surface ${
                  active ? "border-primary ring-1 ring-primary" : "border-border"
                }`}
              >
                <VariantPreview id={variant.id} />
                <div className="space-y-3 p-3">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[13px] font-semibold text-text">
                        {variant.name[language]}
                      </h3>
                      {active ? (
                        <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {t("designLibraryApplied")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      {variant.description[language]}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={active || !canAdd}
                      onClick={() => apply(variant)}
                      className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {active
                        ? t("designLibraryApplied")
                        : variant.scope === "section" && !target
                          ? t("designLibraryAdd")
                          : t("designLibraryApply")}
                    </button>
                    {variant.scope === "section" && target && canAddAnother ? (
                      <button
                        type="button"
                        onClick={() => addSection(variant)}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-text hover:bg-surface-muted"
                      >
                        {t("designLibraryAddAnother")}
                      </button>
                    ) : null}
                    {canRestore ? (
                      <button
                        type="button"
                        onClick={() => restoreDefault(variant)}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-text hover:bg-surface-muted"
                      >
                        {t("designLibraryOriginal")}
                      </button>
                    ) : null}
                    {!canAdd ? (
                      <span className="self-center text-[11px] text-muted">
                        {t("sectionLibraryAlreadyAdded")}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rounded-md bg-surface-muted px-3 py-2 text-[11px] leading-5 text-muted">
        {t("designLibraryWorkflowHint")}
      </p>
    </div>
  );
}

const DESIGN_CATEGORY_MESSAGE: Record<
  DesignLibraryCategory,
  CustomizerMessageKey
> = {
  products: "designLibraryCategoryProducts",
  categories: "designLibraryCategoryCategories",
  promotions: "designLibraryCategoryPromotions",
  featured: "designLibraryCategoryFeatured",
  content: "designLibraryCategoryContent",
};

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 shrink-0 rounded-full border px-3 text-[11px] font-medium ${
        active
          ? "border-primary bg-primary-soft text-primary"
          : "border-border bg-surface text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function VariantPreview({ id }: { id: string }) {
  const shared = "rounded-sm bg-white/90 shadow-sm";
  return (
    <div
      data-design-variant-preview={id}
      className="h-28 overflow-hidden bg-gradient-to-br from-primary/15 via-surface-muted to-accent/15 p-3"
      aria-hidden="true"
    >
      {id === "product-editorial" ? (
        <div className="mx-auto grid h-full max-w-[210px] grid-cols-3 gap-2">
          {[0, 1, 2].map((item) => (
            <span key={item} className={`${shared} flex flex-col p-1.5`}>
              <span className="min-h-0 flex-1 rounded-sm bg-primary/20" />
              <span className="mx-auto mt-1 h-1 w-8 rounded bg-text/30" />
              <span className="mx-auto mt-1 h-1 w-5 rounded bg-primary/50" />
            </span>
          ))}
        </div>
      ) : id === "categories-orbit" ? (
        <div className="flex h-full items-center justify-center gap-3">
          {[0, 1, 2, 3].map((item) => (
            <span key={item} className="flex flex-col items-center gap-2">
              <span className="size-11 rounded-full border-4 border-white bg-primary/25 shadow-sm" />
              <span className="h-1 w-8 rounded bg-text/30" />
            </span>
          ))}
        </div>
      ) : id === "categories-showcase" ? (
        <div className="grid h-full grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((item) => (
            <span key={item} className="relative overflow-hidden rounded-md bg-primary/25">
              <span className="absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-black/50 to-transparent" />
              <span className="absolute bottom-2 start-2 h-1.5 w-10 rounded bg-white/90" />
            </span>
          ))}
        </div>
      ) : id === "banner-split" ? (
        <div className={`${shared} grid h-full grid-cols-2 overflow-hidden rounded-lg`}>
          <span className="flex flex-col justify-center gap-2 p-3">
            <span className="h-2 w-16 rounded bg-text/40" />
            <span className="h-1.5 w-full rounded bg-text/20" />
            <span className="h-5 w-14 rounded bg-primary/70" />
          </span>
          <span className="bg-primary/25" />
        </div>
      ) : id === "featured-rail" ? (
        <div className="flex h-full gap-2 overflow-hidden ps-4">
          {[0, 1, 2, 3].map((item) => (
            <span key={item} className={`${shared} flex w-20 shrink-0 flex-col p-1.5`}>
              <span className="min-h-0 flex-1 rounded-sm bg-primary/20" />
              <span className="mt-1 h-1 w-10 rounded bg-text/30" />
              <span className="mt-1 h-1 w-6 rounded bg-primary/50" />
            </span>
          ))}
        </div>
      ) : (
        <div className="flex h-full gap-2 overflow-hidden">
          {["w-2/3", "w-1/2", "w-2/3"].map((width, item) => (
            <span
              key={item}
              className={`${width} shrink-0 rounded-lg border-4 border-white bg-primary/20 shadow-sm`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

