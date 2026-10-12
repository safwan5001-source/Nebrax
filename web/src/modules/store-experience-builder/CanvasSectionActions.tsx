"use client";

/**
 * CUST-HV V10d (V0 §17.2) — the Canvas hover action bar: move up / down, hide, duplicate and delete for the section under the pointer
 * (or focus, or selection). It performs nothing itself — each button calls a callback the builder wires to the shared pure section
 * operations (`presentation/section-ops.ts`), so the effect is an ordinary draft edit exactly like the section list's. A delete that
 * would lose authored content asks first, inline; an empty section is removed at once, as in the list. The bar is shown for editing
 * only (never on a Published Version, in Theme Preview or in the dev harness) and sits inside the section wrapper so the hero-overlap
 * sibling rules are untouched.
 */

import { useState } from "react";
import type { PresentationHomeSection } from "./presentation";

export interface CanvasSectionActions {
  onMove: (id: string, delta: 1 | -1) => void;
  onDuplicate: (id: string) => void;
  onHide: (id: string) => void;
  onDelete: (id: string) => void;
  labels: {
    toolbar: string;
    moveUp: string;
    moveDown: string;
    duplicate: string;
    hide: string;
    remove: string;
    confirmRemove: string;
    cancel: string;
  };
}

export interface CanvasSectionEligibility {
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  /** Deleting would lose something the merchant wrote or designed — so it asks first. */
  authored: boolean;
}

const btn =
  "inline-flex size-7 items-center justify-center rounded-md text-[13px] leading-none text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-35 disabled:hover:bg-transparent";

export function SectionActionBar({
  section,
  actions,
  eligibility,
}: {
  section: PresentationHomeSection;
  actions: CanvasSectionActions;
  eligibility: CanvasSectionEligibility;
}) {
  const [confirming, setConfirming] = useState(false);
  const { labels } = actions;
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a small floating toolbar of icon buttons
    <div
      role="toolbar"
      aria-label={labels.toolbar}
      data-section-actions={section.id}
      onClick={stop}
      onKeyDown={stop}
      className="absolute end-1 top-1 z-30 hidden items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 text-text shadow-md"
    >
      {confirming ? (
        <>
          <button
            type="button"
            data-section-action="confirm-remove"
            onClick={() => {
              setConfirming(false);
              actions.onDelete(section.id);
            }}
            className={`${btn} w-auto px-2 text-[12px] font-medium text-negative`}
          >
            {labels.confirmRemove}
          </button>
          <button type="button" data-section-action="cancel-remove" autoFocus onClick={() => setConfirming(false)} className={`${btn} w-auto px-2 text-[12px]`}>
            {labels.cancel}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            data-section-action="up"
            aria-label={labels.moveUp}
            title={labels.moveUp}
            disabled={!eligibility.canMoveUp}
            onClick={() => actions.onMove(section.id, -1)}
            className={btn}
          >
            ↑
          </button>
          <button
            type="button"
            data-section-action="down"
            aria-label={labels.moveDown}
            title={labels.moveDown}
            disabled={!eligibility.canMoveDown}
            onClick={() => actions.onMove(section.id, 1)}
            className={btn}
          >
            ↓
          </button>
          <button type="button" data-section-action="hide" aria-label={labels.hide} title={labels.hide} onClick={() => actions.onHide(section.id)} className={btn}>
            ◌
          </button>
          {eligibility.canDuplicate ? (
            <button type="button" data-section-action="duplicate" aria-label={labels.duplicate} title={labels.duplicate} onClick={() => actions.onDuplicate(section.id)} className={btn}>
              ⧉
            </button>
          ) : null}
          {eligibility.canDelete ? (
            <button
              type="button"
              data-section-action="remove"
              aria-label={labels.remove}
              title={labels.remove}
              onClick={() => (eligibility.authored ? setConfirming(true) : actions.onDelete(section.id))}
              className={`${btn} text-negative`}
            >
              ✕
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
