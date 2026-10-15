"use client";

import type { Category } from "@spree/sdk";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MobileNavItem } from "@/components/layout/MobileNavItem";
import { RegionPreferences } from "@/components/layout/RegionPreferences";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { localeDirection } from "@/i18n/locales";
import type { IconKey } from "@/lib/presentation/icon-registry";
import type { NavBadge } from "@/lib/presentation/navigation";
import type { ResolvedNavChild } from "@/lib/presentation/navigation-resolve";

export interface StoreExtraNavLink {
  id: string;
  label: string;
  href: string;
  /** External target opened in a new tab (`rel="noopener noreferrer"`). */
  newTab?: boolean;
  icon?: IconKey;
  badge?: NavBadge;
  /** Published `dropdown` presentation with at least one live child. */
  dropdown?: boolean;
  children?: ResolvedNavChild[];
}

type PanelType = { kind: "main" } | { kind: "category"; category: Category };

interface MobileMenuProps {
  rootCategories: Category[];
  basePath: string;
  /** Whether the wholesale addon is enabled — gates the trade portal link. */
  wholesaleEnabled: boolean;
  /** Merchant-published links, shared with the desktop header. */
  extraLinks?: StoreExtraNavLink[];
}

export function MobileMenu({
  rootCategories,
  basePath,
  wholesaleEnabled,
  extraLinks = [],
}: MobileMenuProps) {
  const t = useTranslations("header");
  const direction = localeDirection(useLocale());
  const drawerSide = direction === "rtl" ? "right" : "left";
  const [open, setOpen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [panelStack, setPanelStack] = useState<PanelType[]>([{ kind: "main" }]);
  // New panels mount off-screen, then animate on the next frame.
  const [animatedIndex, setAnimatedIndex] = useState(0);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentPanel = panelStack[animatedIndex];

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  const cancelPendingCallbacks = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const pushPanel = (panel: PanelType) => {
    cancelPendingCallbacks();
    const nextIndex = animatedIndex + 1;
    flushSync(() => {
      setPanelStack((prev) => [...prev.slice(0, nextIndex), panel]);
    });
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setAnimatedIndex(nextIndex);
    });
  };

  const popPanel = () => {
    cancelPendingCallbacks();
    const nextIndex = Math.max(0, animatedIndex - 1);
    setAnimatedIndex(nextIndex);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setPanelStack((prev) => prev.slice(0, nextIndex + 1));
    }, 300);
  };

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      cancelPendingCallbacks();
      setPanelStack([{ kind: "main" }]);
      setAnimatedIndex(0);
    }
  };

  // Fixed minimum targets never shrink inside a long flex-column catalogue.
  const linkClass =
    "flex min-h-11 min-w-0 shrink-0 items-center text-start text-store-foreground hover:bg-store-surface-muted rounded-lg px-3 py-2.5 text-base break-words [overflow-wrap:anywhere] transition-colors";
  const categoryButtonClass = `${linkClass} justify-between gap-2 w-full cursor-pointer`;
  const navClass =
    "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-4 py-2";
  const panelClass =
    "absolute inset-0 flex min-h-0 flex-col bg-store-surface transition-transform duration-300 ease-in-out motion-reduce:transition-none";
  const previousPanelClass =
    direction === "rtl" ? "translate-x-full" : "-translate-x-full";
  const nextPanelClass =
    direction === "rtl" ? "-translate-x-full" : "translate-x-full";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={() => setHasInteracted(true)}
          aria-label={open ? t("closeMenu") : t("openMenu")}
          className="relative cursor-pointer"
        >
          <div aria-hidden="true" className="relative w-5 h-5">
            <span
              className={`absolute left-0 right-0 h-0.5 bg-current rounded-full top-[2px] ${
                hasInteracted
                  ? open
                    ? "animate-hamburger-top-open"
                    : "animate-hamburger-top-close"
                  : ""
              }`}
            />
            <span
              className={`absolute left-0 right-0 h-0.5 bg-current rounded-full top-1/2 -translate-y-1/2 ${
                hasInteracted
                  ? open
                    ? "animate-hamburger-mid-open"
                    : "animate-hamburger-mid-close"
                  : ""
              }`}
              style={
                hasInteracted && !open
                  ? { animationDelay: "0.2s", opacity: 0 }
                  : undefined
              }
            />
            <span
              className={`absolute left-0 right-0 h-0.5 bg-current rounded-full bottom-[2px] ${
                hasInteracted
                  ? open
                    ? "animate-hamburger-bottom-open"
                    : "animate-hamburger-bottom-close"
                  : ""
              }`}
            />
          </div>
        </Button>
      </SheetTrigger>

      {/* A viewport modal, not a guessed header offset. Chrome stays underneath
          the Radix overlay (z-50 > announcement z-45 / header + bottom nav z-40).
          Leave an outside target even on 320px; retain the tenant theme portal. */}
      <SheetContent
        side={drawerSide}
        dir={direction}
        className="flex min-h-0 flex-col !gap-0 !rounded-none !top-0 !bottom-auto !h-dvh !w-[calc(100%-3rem)] !max-w-sm overflow-hidden bg-store-surface text-store-foreground pt-[env(safe-area-inset-top)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] rtl:ps-[env(safe-area-inset-right)] rtl:pe-[env(safe-area-inset-left)]"
        showCloseButton={false}
        overlayClassName="bg-black/40"
      >
        <div className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-store-border px-4 py-2">
          {currentPanel.kind === "category" ? (
            <button
              type="button"
              onClick={popPanel}
              className="flex min-h-11 min-w-0 items-center gap-2 text-start text-base font-semibold text-store-foreground cursor-pointer"
            >
              <ArrowLeft
                aria-hidden="true"
                className="size-5 shrink-0 rtl:rotate-180"
              />
              <span className="break-words [overflow-wrap:anywhere]">
                {currentPanel.category.name}
              </span>
            </button>
          ) : (
            <SheetTitle>{t("menu")}</SheetTitle>
          )}
          {currentPanel.kind !== "main" && (
            <SheetTitle className="sr-only">{t("menu")}</SheetTitle>
          )}
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={t("closeMenu")}
              className="!size-11 shrink-0 cursor-pointer"
            >
              <X aria-hidden="true" className="size-5" />
            </Button>
          </SheetClose>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            data-mobile-menu-panel="main"
            inert={animatedIndex !== 0}
            className={`${panelClass} ${animatedIndex === 0 ? "translate-x-0" : previousPanelClass}`}
          >
            <nav className={navClass} aria-label={t("menu")}>
              <Link
                href={basePath || "/"}
                onClick={() => handleOpenChange(false)}
                className={linkClass}
              >
                {t("home")}
              </Link>
              <Link
                href={`${basePath}/products`}
                onClick={() => handleOpenChange(false)}
                className={linkClass}
              >
                {t("allProducts")}
              </Link>
              {rootCategories.map((category) =>
                category.children && category.children.length > 0 ? (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => pushPanel({ kind: "category", category })}
                    className={categoryButtonClass}
                  >
                    <span>{category.name}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-store-muted-foreground rtl:rotate-180"
                    />
                  </button>
                ) : (
                  <Link
                    key={category.id}
                    href={`${basePath}/c/${category.permalink}`}
                    onClick={() => handleOpenChange(false)}
                    className={linkClass}
                  >
                    {category.name}
                  </Link>
                ),
              )}
              {extraLinks.map((link) => (
                <MobileNavItem
                  key={link.id}
                  item={link}
                  linkClass={linkClass}
                  onNavigate={() => handleOpenChange(false)}
                />
              ))}
              <Link
                href={`${basePath}/#contact`}
                onClick={() => handleOpenChange(false)}
                className={linkClass}
              >
                {t("contact")}
              </Link>
              <div className="mt-2 shrink-0 border-t border-store-border pt-2">
                {wholesaleEnabled && (
                  <Link
                    href={`${basePath}/wholesale`}
                    onClick={() => handleOpenChange(false)}
                    className={linkClass}
                  >
                    {t("wholesale")}
                  </Link>
                )}
                <SheetClose asChild>
                  <Link href={`${basePath}/account`} className={linkClass}>
                    {t("myAccount")}
                  </Link>
                </SheetClose>
              </div>
            </nav>
          </div>

          {panelStack.map((panel, index) => {
            if (panel.kind !== "category") return null;
            const isAnimatedIn = index <= animatedIndex;
            const translateClass = isAnimatedIn
              ? index < animatedIndex
                ? previousPanelClass
                : "translate-x-0"
              : nextPanelClass;
            return (
              <div
                key={`cat-${panel.category.id}-${index}`}
                data-mobile-menu-panel="category"
                inert={index !== animatedIndex}
                className={`${panelClass} ${translateClass}`}
              >
                <nav className={navClass} aria-label={panel.category.name}>
                  {panel.category.children?.map((child) =>
                    child.children && child.children.length > 0 ? (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() =>
                          pushPanel({ kind: "category", category: child })
                        }
                        className={categoryButtonClass}
                      >
                        <span>{child.name}</span>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-store-muted-foreground rtl:rotate-180"
                        />
                      </button>
                    ) : (
                      <Link
                        key={child.id}
                        href={`${basePath}/c/${child.permalink}`}
                        onClick={() => handleOpenChange(false)}
                        className={linkClass}
                      >
                        {child.name}
                      </Link>
                    ),
                  )}
                </nav>
                <div className="shrink-0 border-t border-store-border px-4 py-2">
                  <Link
                    href={`${basePath}/c/${panel.category.permalink}`}
                    onClick={() => handleOpenChange(false)}
                    className="flex min-h-11 items-center justify-center text-center text-sm text-store-muted-foreground hover:text-store-foreground transition-colors"
                  >
                    {t("viewAllCategory", { category: panel.category.name })}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed outside the scrolling panel, available at every category level. */}
        <SheetFooter className="shrink-0 items-center border-t border-store-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <RegionPreferences variant="menu" />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
