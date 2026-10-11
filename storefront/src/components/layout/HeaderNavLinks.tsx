"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { StoreExtraNavLink } from "@/components/layout/MobileMenu";
import { NavItemContent } from "@/components/layout/NavItemContent";
import { shouldFlipPanel } from "@/lib/presentation/nav-flip";

const LINK =
  "inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1.5 text-sm text-store-muted-foreground transition-colors hover:text-store-foreground";

function ItemLink({
  item,
  marker,
  className,
}: {
  item: Pick<StoreExtraNavLink, "href" | "label" | "icon" | "badge" | "newTab">;
  marker: "data-extra-nav" | "data-nav-child";
  className: string;
}) {
  const content = (
    <NavItemContent label={item.label} icon={item.icon} badge={item.badge} />
  );
  const attr = { [marker]: "" };
  if (item.newTab) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        {...attr}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={item.href} className={className} {...attr}>
      {content}
    </Link>
  );
}

/**
 * One top-level item with a dropdown (V0 §11.3). The label stays a real link to the parent's
 * target; a separate chevron button is the disclosure, so a keyboard / touch user can both go
 * to the parent and open its children — and there is never hover-only access.
 *
 * Keys: `Enter`/`Space` on the button toggles (native click) · `ArrowDown` opens and focuses
 * the first child · inside the panel `ArrowUp/ArrowDown/Home/End` move · `Escape` closes and
 * returns focus to the button · focus leaving the whole item closes it. The panel aligns to the
 * logical inline-start of its parent (`start-0`), so it mirrors in RTL with no extra rule.
 */
function DropdownItem({ item }: { item: StoreExtraNavLink }) {
  const t = useTranslations("header");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // Opened by a mouse hover: the click that follows must pin it open, not toggle it shut.
  const hoverOpened = useRef(false);
  const panel = useRef<HTMLUListElement>(null);
  // Opens from the inline-end edge instead when the default would leave the viewport (see `nav-flip.ts`).
  const [flip, setFlip] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setFlip(false);
      return;
    }
    const el = panel.current;
    const host = root.current;
    if (!el || !host) return;
    const rect = el.getBoundingClientRect();
    const rtl = getComputedStyle(host).direction === "rtl";
    setFlip(
      shouldFlipPanel(
        { left: rect.left, right: rect.right },
        { left: 0, right: document.documentElement.clientWidth },
        rtl,
      ),
    );
  }, [open]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  useEffect(() => cancelClose, [cancelClose]);

  const focusChild = (index: number) => {
    const links =
      root.current?.querySelectorAll<HTMLElement>("[data-nav-child]");
    if (!links?.length) return;
    links[(index + links.length) % links.length]?.focus();
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => focusChild(0));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const onPanelKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const links = [
      ...(root.current?.querySelectorAll<HTMLElement>("[data-nav-child]") ??
        []),
    ];
    const at = links.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusChild(at + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusChild(at - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusChild(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusChild(links.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div
      ref={root}
      data-nav-dropdown=""
      data-open={open ? "" : undefined}
      data-flip={flip ? "" : undefined}
      className="relative inline-flex items-center"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        cancelClose();
        if (!open) hoverOpened.current = true;
        setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        cancelClose();
        hoverOpened.current = false;
        closeTimer.current = setTimeout(() => setOpen(false), 120);
      }}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <ItemLink
        item={item}
        marker="data-extra-nav"
        className={`${LINK} pe-0.5`}
      />
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t(open ? "hideSubmenu" : "showSubmenu", {
          label: item.label,
        })}
        onClick={() => {
          if (hoverOpened.current) {
            hoverOpened.current = false;
            return;
          }
          setOpen((value) => !value);
        }}
        onKeyDown={onButtonKey}
        className="inline-flex size-7 items-center justify-center rounded-store text-store-muted-foreground transition-colors hover:text-store-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-store-primary"
      >
        <ChevronDown
          aria-hidden="true"
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <ul
        ref={panel}
        id={panelId}
        hidden={!open}
        onKeyDown={onPanelKey}
        data-nav-panel=""
        className={`absolute ${flip ? "end-0" : "start-0"} top-full z-50 mt-1 min-w-48 rounded-store border border-store-border bg-store-surface py-1 shadow-lg`}
      >
        {item.children?.map((child) => (
          <li key={child.id}>
            <ItemLink
              item={child}
              marker="data-nav-child"
              className="flex w-full items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm text-store-foreground transition-colors hover:bg-store-surface-muted focus-visible:bg-store-surface-muted focus-visible:outline-none"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The published header navigation (desktop, from `lg`). Plain items stay plain links; only an
 * item the merchant made a `dropdown` (with at least one live child) becomes a disclosure.
 */
export function HeaderNavLinks({ items }: { items: StoreExtraNavLink[] }) {
  if (items.length === 0) return null;
  return <NavList items={items} />;
}

function NavList({ items }: { items: StoreExtraNavLink[] }) {
  const t = useTranslations("header");
  return (
    <nav aria-label={t("mainMenu")} className="hidden lg:block">
      <ul className="flex items-center">
        {items.map((item) => (
          <li key={item.id}>
            {item.dropdown && item.children?.length ? (
              <DropdownItem item={item} />
            ) : (
              <ItemLink item={item} marker="data-extra-nav" className={LINK} />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
