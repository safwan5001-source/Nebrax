"use client";

import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { shouldFlipPanel } from "./presentation/nav-flip";
import { StoreIcon } from "./StoreIcon";
import {
  isServedContentSlug,
  type NavBadge,
  type NavItem,
  type NavMenu,
} from "./presentation/navigation";

/**
 * CUST-HV V7d-3 — the Canvas draw of the published `main` menu (V0 §11.3). The Canvas has no live
 * catalogue, so a category / product target is drawn from its label alone; what it *can* know it
 * mirrors from the storefront — disabled and label-less items are absent, an external target with
 * a bad URL cannot exist (the normaliser dropped it), and a content page the storefront does not
 * serve yet is absent too.
 */
export function canvasNavItems(menu: NavMenu): NavItem[] {
  const shown = (item: NavItem) =>
    item.enabled &&
    item.label.trim() !== "" &&
    (item.target.kind !== "content" || isServedContentSlug(item.target.slug));
  return menu.items.filter(shown).map((item) => ({
    ...item,
    children: (item.children ?? []).filter(shown),
  }));
}

function Chip({ badge }: { badge: NavBadge }) {
  return (
    <span
      data-nav-badge={badge.tone ?? "brand"}
      className={cn(
        "rounded-full px-1.5 py-px text-[0.625rem] font-bold leading-4",
        badge.tone === "accent"
          ? "bg-store-accent text-store-accent-foreground"
          : "bg-store-primary text-store-primary-foreground",
      )}
    >
      {badge.text}
    </span>
  );
}

function Inner({ item }: { item: NavItem }) {
  return (
    <>
      {item.icon ? <StoreIcon name={item.icon} /> : null}
      <span>{item.label.trim()}</span>
      {item.badge ? <Chip badge={item.badge} /> : null}
    </>
  );
}

/** One top-level item. A dropdown opens on hover / focus-within, like the storefront's disclosure. */
export function CanvasNavItem({ item }: { item: NavItem }) {
  const kids = item.children ?? [];
  const dropdown = item.presentation?.kind === "dropdown" && kids.length > 0;
  if (!dropdown) {
    return (
      <span
        data-extra-nav=""
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-store-muted-foreground"
      >
        <Inner item={item} />
      </span>
    );
  }
  return <CanvasDropdown item={item} kids={kids} />;
}

/**
 * The Canvas disclosure: opens on hover and on focus-within (the Canvas is a preview, so there is no click-to-pin), and — like
 * the storefront — opens from the inline-end edge instead when the default would pass the Canvas frame (`nav-flip.ts`).
 */
function CanvasDropdown({ item, kids }: { item: NavItem; kids: NavItem[] }) {
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setFlip(false);
      return;
    }
    const el = panel.current;
    const frame = root.current?.closest("[data-preview-canvas]");
    if (!el || !frame || !root.current) return;
    const rect = el.getBoundingClientRect();
    const bounds = frame.getBoundingClientRect();
    setFlip(
      shouldFlipPanel(
        { left: rect.left, right: rect.right },
        { left: bounds.left, right: bounds.right },
        getComputedStyle(root.current).direction === "rtl",
      ),
    );
  }, [open]);

  return (
    <span
      ref={root}
      data-nav-dropdown=""
      data-flip={flip ? "" : undefined}
      className="relative inline-flex items-center"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span
        data-extra-nav=""
        tabIndex={0}
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-store-muted-foreground"
      >
        <Inner item={item} />
        <ChevronDown aria-hidden className="size-3.5" />
      </span>
      <span
        ref={panel}
        data-nav-panel=""
        hidden={!open}
        className={cn(
          "absolute top-full z-50 mt-1 min-w-44 flex-col rounded-store border border-store-border bg-store-surface py-1 shadow-lg",
          flip ? "end-0" : "start-0",
          open ? "flex" : "hidden",
        )}
      >
        {kids.map((child) => (
          <span
            key={child.id}
            data-nav-child=""
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-store-foreground"
          >
            <Inner item={child} />
          </span>
        ))}
      </span>
    </span>
  );
}
