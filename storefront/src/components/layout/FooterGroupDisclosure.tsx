"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

/** Below this width (px) a collapsible footer group is a disclosure; Tailwind's `md` is 768. */
const NARROW_QUERY = "(max-width: 767.98px)";

/**
 * CUST-HV V7e-2 — one footer link group that collapses into a disclosure on phones (V0 §10.2: ">4 groups collapse into
 * disclosure sections", brand-heavy "columns collapse into disclosures").
 *
 * Progressive: the server render, no-JavaScript and every width from `md` up are the plain group (a heading over its links),
 * so nothing is ever hidden without a script that can reveal it. Only once mounted on a narrow viewport does the heading become
 * a real `<button aria-expanded aria-controls>` over a collapsed list — and it turns back into a plain heading if the viewport
 * widens, so a keyboard user never lands on a control that does nothing.
 */
export function FooterGroupDisclosure({
  id,
  title,
  collapsible,
  headingClassName,
  listClassName,
  children,
}: {
  id: string;
  title: string;
  collapsible: boolean;
  headingClassName: string;
  listClassName: string;
  children: ReactNode;
}) {
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false);
  const panel = useId();

  useEffect(() => {
    if (!collapsible || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const sync = () => {
      setNarrow(query.matches);
      if (!query.matches) setOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [collapsible]);

  const asDisclosure = collapsible && narrow;

  return (
    <nav
      aria-labelledby={id}
      data-footer-group=""
      data-collapsed={asDisclosure && !open ? "" : undefined}
    >
      <h2 id={id} className={headingClassName}>
        {asDisclosure ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between gap-2 text-start focus-visible:outline-store-footer-foreground"
          >
            <span>{title}</span>
            <ChevronDown
              aria-hidden="true"
              className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          title
        )}
      </h2>
      <ul id={panel} hidden={asDisclosure && !open} className={listClassName}>
        {children}
      </ul>
    </nav>
  );
}
