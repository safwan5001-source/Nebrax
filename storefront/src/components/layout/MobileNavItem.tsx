"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { StoreExtraNavLink } from "@/components/layout/MobileMenu";
import { NavItemContent } from "@/components/layout/NavItemContent";

/**
 * CUST-HV V7d-3 — one published navigation item in the mobile menu (V0 §11.3). Every enabled
 * header item appears here at every width below `lg` (the DEF-1 parity rule); an item with
 * children is an accordion — the label stays a link to the parent's target, the chevron button
 * discloses the children (`aria-expanded` / `aria-controls`).
 */
export function MobileNavItem({
  item,
  linkClass,
  onNavigate,
}: {
  item: StoreExtraNavLink;
  linkClass: string;
  onNavigate: () => void;
}) {
  const t = useTranslations("header");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const hasChildren = Boolean(item.children?.length);

  const anchor = (
    link: Pick<
      StoreExtraNavLink,
      "href" | "label" | "icon" | "badge" | "newTab"
    >,
    className: string,
    marker: Record<string, string>,
  ) =>
    link.newTab ? (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className={className}
        {...marker}
      >
        <NavItemContent
          label={link.label}
          icon={link.icon}
          badge={link.badge}
        />
      </a>
    ) : (
      <Link
        href={link.href}
        onClick={onNavigate}
        className={className}
        {...marker}
      >
        <NavItemContent
          label={link.label}
          icon={link.icon}
          badge={link.badge}
        />
      </Link>
    );

  const rowClass = `${linkClass} flex items-center gap-2`;

  if (!hasChildren) {
    return anchor(item, rowClass, { "data-mobile-extra-nav": "" });
  }

  return (
    <div data-mobile-nav-group="" className="shrink-0">
      <div className="flex items-center">
        {anchor(item, `${rowClass} flex-1`, { "data-mobile-extra-nav": "" })}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t(open ? "hideSubmenu" : "showSubmenu", {
            label: item.label,
          })}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-store-muted-foreground hover:bg-store-surface-muted hover:text-store-foreground"
        >
          <ChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      <ul
        id={panelId}
        hidden={!open}
        className="ms-3 border-s border-store-border ps-2"
      >
        {item.children?.map((child) => (
          <li key={child.id}>
            {anchor(child, `${rowClass} text-[0.9375rem]`, {
              "data-mobile-nav-child": "",
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
