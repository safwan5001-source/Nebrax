"use client";

import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gift,
  Heart,
  Info,
  type LucideIcon,
  Megaphone,
  Pause,
  Percent,
  Play,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { storeContainerClassName } from "@/components/layout/StoreContainer";
import { localeDirection } from "@/i18n/locales";
import {
  type Announcement,
  type AnnouncementIconKey,
  type AnnouncementsDoc,
  announcementDismissKey,
  announcementPageKind,
  eligibleAnnouncements,
  nextAnnouncementBoundary,
  resolveAnnouncementSurface,
} from "@/lib/presentation/announcements";
import { cn } from "@/lib/utils";

/**
 * CUST-HV V3 — the published announcement bar (contract §12).
 *
 * One client component so the clock (windows), the route (page targeting),
 * `localStorage` (dismissal) and `prefers-reduced-motion` are all read where
 * they live. Every default is the quiet one: with no `behaviour` it is a static
 * line showing the first eligible item. Motion (rotation, ticker) is opt-in,
 * pausable, never under reduced motion, and never the only place a message is
 * readable.
 *
 * Deliberately **not** `role="alert"` / `aria-live`: a promotional bar must not
 * interrupt a screen reader. It is a labelled region.
 */

const ICONS: Record<AnnouncementIconKey, LucideIcon> = {
  megaphone: Megaphone,
  bell: Bell,
  info: Info,
  tag: Tag,
  percent: Percent,
  truck: Truck,
  gift: Gift,
  clock: Clock,
  star: Star,
  heart: Heart,
  sparkles: Sparkles,
  "shield-check": ShieldCheck,
};

const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
/** Seconds of marquee travel per character — and a floor — per speed preset. */
const TICKER_TIMING = {
  slow: { perChar: 0.45, min: 30 },
  normal: { perChar: 0.3, min: 20 },
  fast: { perChar: 0.2, min: 12 },
} as const;
const TOUCH_PAUSE_MS = 5000;
const COLLAPSE_AFTER_PX = 80;
const SCROLL_DELTA_PX = 8;

interface AnnouncementBarProps {
  doc: AnnouncementsDoc;
  basePath: string;
  /** Server clock, so the first paint agrees with the HTML; the client re-reads on mount. */
  serverNow: number;
}

function readDismissed(items: Announcement[]): Set<string> {
  const dismissed = new Set<string>();
  try {
    for (const item of items) {
      const key = announcementDismissKey(item);
      if (window.localStorage.getItem(key) === "1") dismissed.add(key);
    }
  } catch {
    // Storage unavailable (private mode, blocked): dismissal lasts for the page.
  }
  return dismissed;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function ItemContent({
  item,
  basePath,
  linkClass,
  focusable = true,
}: {
  item: Announcement;
  basePath: string;
  linkClass: string;
  focusable?: boolean;
}) {
  const Icon = item.icon ? ICONS[item.icon] : null;
  const body = (
    <>
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
      <bdi>{item.text}</bdi>
    </>
  );
  if (!item.href) {
    return <span className="inline-flex items-center gap-2">{body}</span>;
  }
  const external = !item.href.startsWith("/");
  const tabIndex = focusable ? undefined : -1;
  return external ? (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={tabIndex}
      className={linkClass}
    >
      {body}
    </a>
  ) : (
    <Link
      href={`${basePath}${item.href}`}
      tabIndex={tabIndex}
      className={linkClass}
    >
      {body}
    </Link>
  );
}

export function AnnouncementBar({
  doc,
  basePath,
  serverNow,
}: AnnouncementBarProps) {
  const t = useTranslations("announcements");
  const locale = useLocale();
  const rtl = localeDirection(locale) === "rtl";
  const pathname = usePathname();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const handheld = useMediaQuery("(max-width: 47.99rem)");

  const behaviour = doc.behaviour ?? {};
  const [now, setNow] = useState(serverNow);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  // `auto` pauses on hover/focus/touch; an explicit Pause or Play from the
  // shopper overrides that — pressing Play must not be undone by the focus the
  // button itself keeps.
  const [userChoice, setUserChoice] = useState<"auto" | "paused" | "playing">(
    "auto",
  );
  const [collapsed, setCollapsed] = useState(false);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLElement | null>(null);

  // Real time after hydration, and a wake-up at the next window boundary so a
  // campaign starts / ends without a reload (no scheduler, no server state).
  useEffect(() => {
    setNow(Date.now());
    setDismissed(readDismissed(doc.items));
  }, [doc.items]);
  // `now` is a deliberate trigger: each wake-up re-arms the timer for the next boundary.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const boundary = nextAnnouncementBoundary(doc, Date.now());
    if (boundary === null) return;
    const wait = Math.min(
      Math.max(boundary - Date.now() + 250, 1000),
      MAX_TIMER_MS,
    );
    const timer = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [doc, now]);

  const kind = announcementPageKind(pathname ?? "", basePath);
  const items = useMemo(
    () =>
      eligibleAnnouncements(doc, kind, now).filter(
        (item) => !dismissed.has(announcementDismissKey(item)),
      ),
    [doc, kind, now, dismissed],
  );

  const ticker =
    behaviour.ticker === true && !reducedMotion && items.length > 0;
  const rotating =
    behaviour.rotate === true && !reducedMotion && !ticker && items.length > 1;
  const userPaused = userChoice === "paused";
  const paused =
    userChoice === "paused" ||
    (userChoice === "auto" && (hovered || focused || touched));
  const intervalMs = (behaviour.rotateInterval ?? 8) * 1000;
  const current = items.length > 0 ? items[index % items.length] : null;

  // `index` is a deliberate trigger: a manual step restarts the dwell time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!rotating || paused) return;
    const timer = setTimeout(
      () => setIndex((i) => (i + 1) % items.length),
      intervalMs,
    );
    return () => clearTimeout(timer);
  }, [rotating, paused, index, items.length, intervalMs]);

  const step = useCallback(
    (delta: number) =>
      setIndex((i) => (i + delta + items.length) % items.length),
    [items.length],
  );

  const sticky = behaviour.sticky === true;
  const hidden = sticky && handheld && collapsed;

  // Sticky: tell the header (and anything sticky under it) how tall the band is.
  useEffect(() => {
    const root = document.documentElement;
    const node = barRef.current;
    if (!sticky || !node || hidden || items.length === 0) {
      root.style.removeProperty("--store-announcement-height");
      return;
    }
    const publish = () =>
      root.style.setProperty(
        "--store-announcement-height",
        `${node.offsetHeight}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--store-announcement-height");
    };
  }, [sticky, hidden, items.length]);

  // Below `md` the sticky stack must never exceed one band: collapse on
  // scroll-down, return on scroll-up or at the top.
  useEffect(() => {
    if (!sticky || !handheld) {
      setCollapsed(false);
      return;
    }
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - last;
      if (y <= COLLAPSE_AFTER_PX) setCollapsed(false);
      else if (delta > SCROLL_DELTA_PX) setCollapsed(true);
      else if (delta < -SCROLL_DELTA_PX) setCollapsed(false);
      if (Math.abs(delta) > SCROLL_DELTA_PX) last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sticky, handheld]);

  useEffect(
    () => () => {
      if (touchTimer.current) clearTimeout(touchTimer.current);
    },
    [],
  );

  if (items.length === 0 || current === null) return null;

  const dismissible = behaviour.dismissible === true;
  const dismiss = () => {
    const targets = ticker ? items : [current];
    setDismissed((previous) => {
      const next = new Set(previous);
      for (const item of targets) {
        const key = announcementDismissKey(item);
        next.add(key);
        try {
          window.localStorage.setItem(key, "1");
        } catch {
          // Page-session only.
        }
      }
      return next;
    });
    setIndex(0);
  };

  const surface = resolveAnnouncementSurface(current.surface);
  const style: CSSProperties | undefined = surface
    ? {
        backgroundColor: surface.background,
        color: surface.foreground,
        ["--ann-link" as string]: surface.link,
      }
    : undefined;
  const linkClass = cn(
    "inline-flex items-center gap-2 underline underline-offset-2 hover:no-underline",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
    surface ? "text-[var(--ann-link)]" : "",
  );

  const hasControls = rotating || ticker || dismissible;
  const buttonClass =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-store hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-current";

  const totalChars = items.reduce(
    (sum, item) => sum + Array.from(item.text).length,
    0,
  );
  const timing = TICKER_TIMING[behaviour.tickerSpeed ?? "normal"];
  const tickerStyle = {
    "--awj-ann-duration": `${Math.max(timing.min, Math.round(totalChars * timing.perChar))}s`,
    "--awj-ann-dir": rtl ? -1 : 1,
  } as CSSProperties;

  return (
    <section
      ref={barRef}
      aria-label={t("region")}
      data-announcement-bar=""
      data-sticky={sticky ? "" : undefined}
      data-mode={ticker ? "ticker" : rotating ? "rotate" : "static"}
      inert={hidden}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
      onTouchStart={() => {
        setTouched(true);
        if (touchTimer.current) clearTimeout(touchTimer.current);
        touchTimer.current = setTimeout(
          () => setTouched(false),
          TOUCH_PAUSE_MS,
        );
      }}
      className={cn(
        "relative z-[45] border-b border-store-border/20 text-sm",
        surface ? "" : "bg-store-primary text-store-primary-foreground",
        sticky
          ? "sticky top-0 transition-transform duration-200 motion-reduce:transition-none"
          : "",
        hidden ? "-translate-y-full" : "",
        paused && ticker ? "awj-ann-paused" : "",
      )}
      style={style}
    >
      <div
        className={cn(
          storeContainerClassName,
          "flex items-center gap-2",
          hasControls ? "min-h-11" : "min-h-9 py-1.5",
        )}
      >
        {/* Spacer keeps the message centred when controls sit at the end. */}
        {hasControls ? (
          <span className="size-11 shrink-0 max-sm:hidden" aria-hidden="true" />
        ) : null}

        <div className="min-w-0 flex-1 text-center">
          {ticker ? (
            <div
              className="awj-ann-viewport overflow-hidden py-2"
              style={tickerStyle}
            >
              {/* Full text always reachable by assistive tech, once. */}
              <span className="sr-only">
                {items.map((item) => item.text).join(" · ")}
              </span>
              <div className="awj-ann-track" aria-hidden="true">
                {[0, 1].map((copy) => (
                  <ul key={copy} className="awj-ann-copy">
                    {items.map((item) => (
                      <li key={item.id}>
                        <ItemContent
                          item={item}
                          basePath={basePath}
                          linkClass={linkClass}
                          focusable={copy === 0}
                        />
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          ) : (
            <p
              key={current.id}
              className={cn(
                "line-clamp-2 py-1 leading-snug",
                rotating ? "awj-ann-fade" : "",
              )}
            >
              <ItemContent
                item={current}
                basePath={basePath}
                linkClass={linkClass}
              />
            </p>
          )}
        </div>

        {hasControls ? (
          <div className="flex shrink-0 items-center">
            {rotating ? (
              <>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => step(-1)}
                  aria-label={t("previous")}
                >
                  <ChevronLeft
                    aria-hidden="true"
                    className="size-4 rtl:rotate-180"
                  />
                </button>
                <span className="px-1 text-xs tabular-nums" aria-hidden="true">
                  {(index % items.length) + 1}/{items.length}
                </span>
                <span className="sr-only">
                  {t("position", {
                    current: (index % items.length) + 1,
                    total: items.length,
                  })}
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => step(1)}
                  aria-label={t("next")}
                >
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 rtl:rotate-180"
                  />
                </button>
              </>
            ) : null}
            {rotating || ticker ? (
              <button
                type="button"
                className={buttonClass}
                aria-pressed={userPaused}
                aria-label={userPaused ? t("play") : t("pause")}
                onClick={() => setUserChoice(userPaused ? "playing" : "paused")}
              >
                {userPaused ? (
                  <Play aria-hidden="true" className="size-4" />
                ) : (
                  <Pause aria-hidden="true" className="size-4" />
                )}
              </button>
            ) : null}
            {dismissible ? (
              <button
                type="button"
                className={buttonClass}
                aria-label={t("dismiss")}
                onClick={dismiss}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
