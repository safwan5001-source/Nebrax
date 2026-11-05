"use client";

import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type Swiper from "swiper";
import { Navigation } from "swiper/modules";
import { Swiper as SwiperComponent, SwiperSlide } from "swiper/react";
import type { SwiperOptions } from "swiper/types";
import type { StoreProductSummary } from "@/lib/commerce/types";
import "swiper/css";
import "swiper/css/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePublishedThemeMarker } from "@/components/layout/PublishedThemeMarker";
import { ProductCard } from "@/components/products/ProductCard";

interface ProductCarouselProps {
  products: StoreProductSummary[];
  basePath: string;
  /** Optional currency used for analytics in each ProductCard. */
  currency?: string;
  /** Analytics list identity for each ProductCard. Defaults preserve this
   * component's original (only) caller's values, so existing behavior is
   * unchanged when callers don't pass these. */
  listId?: string;
  listName?: string;
  /**
   * Slides visible below the first breakpoint. Defaults to this component's
   * original single-card mobile behavior. A caller mounting this as a
   * *replacement* for a multi-column grid (e.g. a home product shelf) should
   * pass 2 — the storefront's locked responsive baseline requires two-column
   * product browsing on mobile, and a bare carousel default would silently
   * regress that to one.
   */
  slidesPerView?: number;
  /** Defaults preserve this component's original breakpoints. */
  breakpoints?: Record<number, SwiperOptions>;
}

const NAV_BUTTON_BASE =
  "absolute top-1/2 -translate-y-1/2 z-10 flex size-10 items-center justify-center cursor-pointer rounded-full border border-store-border bg-store-surface text-store-muted-foreground shadow-sm transition-colors hover:bg-store-surface-muted hover:text-store-foreground";

/**
 * An arrow with nowhere to go is disabled and invisible, but still occupies its box above the slides. Without
 * `pointer-events-none` it swallows taps meant for the card controls beneath it — notably the first card's Quick View
 * (bottom-start of the image), which the start arrow sits right over on phones.
 */
const HIDDEN_NAV_BUTTON = "pointer-events-none opacity-0";

const DEFAULT_BREAKPOINTS: Record<number, SwiperOptions> = {
  640: { slidesPerView: 2, spaceBetween: 24 },
  768: { slidesPerView: 3, spaceBetween: 24 },
  1024: { slidesPerView: 4, spaceBetween: 24 },
};

export function ProductCarousel({
  products,
  basePath,
  currency,
  listId = "featured-products",
  listName = "Featured Products",
  slidesPerView = 1,
  breakpoints = DEFAULT_BREAKPOINTS,
}: ProductCarouselProps): ReactElement {
  const t = useTranslations("products");
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);

  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const isLuxe = usePublishedThemeMarker() === "awj-luxe-motion";
  // Luxe cards carry a tall portrait image with Quick View at its bottom-start corner. `top-1/2` of the whole slide
  // (image + body) lands on that corner, so a visible arrow would sit on the first card's Quick View. Centre the arrows
  // on the image instead (measured, so any merchant image ratio works). Other themes keep `top-1/2` untouched.
  const [arrowTop, setArrowTop] = useState<number | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    const image = isLuxe
      ? root?.querySelector<HTMLElement>("[data-card-image]")
      : null;
    if (!root || !image) {
      setArrowTop(null);
      return;
    }
    const measure = () => {
      const top =
        image.getBoundingClientRect().top - root.getBoundingClientRect().top;
      setArrowTop(Math.round(top + image.getBoundingClientRect().height / 2));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(image);
    return () => observer.disconnect();
  }, [isLuxe]);
  const arrowStyle = arrowTop === null ? undefined : { top: arrowTop };

  const handleBeforeInit = useCallback((swiper: Swiper) => {
    if (typeof swiper.params.navigation === "object") {
      swiper.params.navigation.prevEl = prevRef.current;
      swiper.params.navigation.nextEl = nextRef.current;
    }
  }, []);

  const updateNavState = useCallback((swiper: Swiper) => {
    setIsBeginning(swiper.isBeginning);
    setIsEnd(swiper.isEnd);
  }, []);

  if (products.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">{t("noProductsFound")}</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      {/*
        `start-2`/`end-2` (inside the track, overlaying its edge slide)
        rather than a negative offset outside it: this component has no
        control over how much side padding its caller's container provides,
        and a negative offset bled past `StoreContainer`'s own padding into
        the page edge — clipped on mobile, floating in open space on desktop.
        Overlaying the track itself is safe at any container width.
      */}
      <button
        ref={prevRef}
        type="button"
        style={arrowStyle}
        aria-label={t("carouselPrev")}
        disabled={isBeginning}
        className={`${NAV_BUTTON_BASE} start-2 ${isBeginning ? HIDDEN_NAV_BUTTON : ""}`}
      >
        <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
      </button>
      <button
        ref={nextRef}
        type="button"
        style={arrowStyle}
        aria-label={t("carouselNext")}
        disabled={isEnd}
        className={`${NAV_BUTTON_BASE} end-2 ${isEnd ? HIDDEN_NAV_BUTTON : ""}`}
      >
        <ChevronRight className="w-5 h-5 rtl:rotate-180" />
      </button>
      <SwiperComponent
        modules={[Navigation]}
        spaceBetween={24}
        slidesPerView={slidesPerView}
        navigation={{
          prevEl: prevRef.current,
          nextEl: nextRef.current,
        }}
        onBeforeInit={handleBeforeInit}
        onSlideChange={updateNavState}
        onReachBeginning={updateNavState}
        onReachEnd={updateNavState}
        onAfterInit={updateNavState}
        breakpoints={breakpoints}
        className="product-carousel"
      >
        {products.map((product, index) => (
          <SwiperSlide key={product.id} className="p-1">
            <ProductCard
              product={product}
              basePath={basePath}
              index={index}
              listId={listId}
              listName={listName}
              currency={currency}
              fetchPriority={index === 0 ? "high" : undefined}
            />
          </SwiperSlide>
        ))}
      </SwiperComponent>
    </div>
  );
}
