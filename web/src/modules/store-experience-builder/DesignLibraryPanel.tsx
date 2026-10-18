"use client";

import Image from "next/image";
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
type PreviewLanguage = "ar" | "en";

const PREVIEW_COPY = {
  en: {
    products: [
      {
        name: "Woven carryall",
        price: "SAR 129",
        image: "/store-design-library/woven-tote.svg",
      },
      {
        name: "Amber serum",
        price: "SAR 89",
        image: "/store-design-library/amber-serum.svg",
      },
      {
        name: "Studio mug",
        price: "SAR 54",
        image: "/store-design-library/studio-mug.svg",
      },
    ],
    categories: [
      { name: "Fashion", image: "/store-design-library/woven-tote.svg" },
      { name: "Beauty", image: "/store-design-library/amber-serum.svg" },
      { name: "Home", image: "/store-design-library/soft-living.svg" },
      { name: "Tech", image: "/store-design-library/sand-headphones.svg" },
    ],
    promotion: {
      eyebrow: "SUMMER EDIT",
      title: "Fresh looks, lighter days",
      offer: "Up to 30% off",
      action: "Shop now",
    },
    featured: { title: "Editor’s picks", action: "View all" },
    gallery: { eyebrow: "THE HOME EDIT", title: "Made for slow mornings" },
  },
  ar: {
    products: [
      {
        name: "حقيبة منسوجة",
        price: "129 ر.س",
        image: "/store-design-library/woven-tote.svg",
      },
      {
        name: "سيروم العنبر",
        price: "89 ر.س",
        image: "/store-design-library/amber-serum.svg",
      },
      {
        name: "كوب الاستوديو",
        price: "54 ر.س",
        image: "/store-design-library/studio-mug.svg",
      },
    ],
    categories: [
      { name: "الأزياء", image: "/store-design-library/woven-tote.svg" },
      { name: "الجمال", image: "/store-design-library/amber-serum.svg" },
      { name: "المنزل", image: "/store-design-library/soft-living.svg" },
      { name: "التقنية", image: "/store-design-library/sand-headphones.svg" },
    ],
    promotion: {
      eyebrow: "تشكيلة الصيف",
      title: "إطلالات جديدة لأيام أخف",
      offer: "خصم حتى 30٪",
      action: "تسوّق الآن",
    },
    featured: { title: "مختارات المحررين", action: "عرض الكل" },
    gallery: { eyebrow: "مجموعة المنزل", title: "مصممة لصباح هادئ" },
  },
} as const;

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
              ? { ...section, design: { ...variant.design } }
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
        <ul className="grid grid-cols-1 gap-3">
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
                <VariantPreview id={variant.id} language={language} />
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

function DemoImage({ src, className }: { src: string; className: string }) {
  return (
    <Image
      src={src}
      alt=""
      width={320}
      height={240}
      sizes="160px"
      className={className}
      draggable={false}
      unoptimized
    />
  );
}

function VariantPreview({
  id,
  language,
}: {
  id: string;
  language: PreviewLanguage;
}) {
  const copy = PREVIEW_COPY[language];
  return (
    <div
      data-design-variant-preview={id}
      data-preview-direction={language === "ar" ? "rtl" : "ltr"}
      dir={language === "ar" ? "rtl" : "ltr"}
      className="h-40 overflow-hidden border-b border-border bg-surface-muted p-3 text-text"
      aria-hidden="true"
    >
      {id === "product-editorial" ? (
        <div
          data-preview-layout="editorial-products"
          className="grid h-full grid-cols-3 gap-2"
        >
          {copy.products.map((product) => (
            <article
              key={product.name}
              className="min-w-0 overflow-hidden rounded-md border border-border bg-surface shadow-sm"
            >
              <DemoImage
                src={product.image}
                className="h-[86px] w-full object-cover"
              />
              <div className="px-1.5 py-1.5 text-center">
                <p className="truncate text-[9px] font-semibold leading-3 text-text">
                  {product.name}
                </p>
                <p className="mt-0.5 text-[9px] font-extrabold leading-3 text-primary">
                  {product.price}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : id === "categories-orbit" ? (
        <div
          data-preview-layout="category-circles"
          className="flex h-full flex-col justify-center rounded-lg border border-border bg-surface px-2 py-3 shadow-sm"
        >
          <p className="mb-3 text-center text-[10px] font-bold text-text">
            {language === "ar" ? "تسوّق حسب التصنيف" : "Shop by category"}
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {copy.categories.map((category) => (
              <div key={category.name} className="min-w-0 text-center">
                <DemoImage
                  src={category.image}
                  className="mx-auto aspect-square w-full max-w-12 rounded-full border-2 border-surface object-cover shadow-md ring-1 ring-border"
                />
                <p className="mt-2 truncate text-[9px] font-semibold text-text">
                  {category.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : id === "categories-showcase" ? (
        <div
          data-preview-layout="category-showcase"
          className="grid h-full grid-cols-[1.35fr_1fr] grid-rows-2 gap-2"
        >
          {copy.categories.slice(0, 3).map((category, index) => (
            <div
              key={category.name}
              className={`relative min-w-0 overflow-hidden rounded-lg border border-border shadow-sm ${
                index === 0 ? "row-span-2" : ""
              }`}
            >
              <DemoImage
                src={category.image}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-text/80 px-2 py-1.5 text-surface">
                <p className="truncate text-[9px] font-bold">
                  {category.name}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : id === "banner-split" ? (
        <div
          data-preview-layout="split-promotion"
          className="grid h-full grid-cols-[1.12fr_.88fr] overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
        >
          <div className="flex min-w-0 flex-col items-start justify-center p-3">
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[8px] font-extrabold tracking-wide text-primary">
              {copy.promotion.eyebrow}
            </span>
            <p className="mt-2 max-w-32 text-[13px] font-extrabold leading-4 text-text">
              {copy.promotion.title}
            </p>
            <p className="mt-1 text-[9px] font-semibold text-muted">
              {copy.promotion.offer}
            </p>
            <span className="mt-2 rounded-md bg-primary px-2.5 py-1 text-[9px] font-bold text-primary-foreground">
              {copy.promotion.action}
            </span>
          </div>
          <DemoImage
            src="/store-design-library/summer-edit.svg"
            className="h-full w-full object-cover"
          />
        </div>
      ) : id === "featured-rail" ? (
        <div data-preview-layout="featured-rail" className="h-full">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[11px] font-extrabold text-text underline decoration-primary decoration-2 underline-offset-4">
              {copy.featured.title}
            </p>
            <span className="text-[8px] font-bold text-primary">
              {copy.featured.action}
            </span>
          </div>
          <div className="grid h-[112px] grid-cols-3 gap-2 overflow-hidden">
            {[copy.products[1], copy.products[2], copy.products[0]].map(
              (product) => (
                <article
                  key={product.name}
                  className="min-w-0 overflow-hidden rounded-md border border-border bg-surface shadow-sm"
                >
                  <DemoImage
                    src={product.image}
                    className="h-[72px] w-full object-cover"
                  />
                  <div className="px-1.5 py-1">
                    <p className="truncate text-[8px] font-semibold text-text">
                      {product.name}
                    </p>
                    <p className="mt-0.5 text-[8px] font-extrabold text-primary">
                      {product.price}
                    </p>
                  </div>
                </article>
              ),
            )}
          </div>
        </div>
      ) : (
        <div
          data-preview-layout="story-gallery"
          className="grid h-full grid-cols-[1.55fr_.8fr] grid-rows-2 gap-2"
        >
          <div className="relative row-span-2 overflow-hidden rounded-lg border border-border shadow-sm">
            <DemoImage
              src="/store-design-library/soft-living.svg"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-x-2 bottom-2 rounded-md bg-surface/90 p-2 shadow-sm">
              <p className="text-[8px] font-extrabold tracking-wide text-primary">
                {copy.gallery.eyebrow}
              </p>
              <p className="mt-0.5 text-[10px] font-bold leading-3 text-text">
                {copy.gallery.title}
              </p>
            </div>
          </div>
          <DemoImage
            src="/store-design-library/studio-mug.svg"
            className="h-full min-h-0 w-full rounded-lg border border-border object-cover shadow-sm"
          />
          <DemoImage
            src="/store-design-library/woven-tote.svg"
            className="h-full min-h-0 w-full rounded-lg border border-border object-cover shadow-sm"
          />
        </div>
      )}
    </div>
  );
}
