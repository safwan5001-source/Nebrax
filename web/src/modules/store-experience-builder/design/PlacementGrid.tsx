"use client";

import { RotateCcw } from "lucide-react";
import { Field, btnClass } from "../ControlPanels";
import type { CustomizerMessageKey } from "../messages";
import { ALIGNS, type Align } from "../presentation/section-design";

type T = (key: CustomizerMessageKey) => string;

const ROWS = ["mediaRowTop", "mediaRowMiddle", "mediaRowBottom"] as const;
const COLS = ["designAlignStart", "designAlignCenter", "designAlignEnd"] as const;

/**
 * CUST-HV V6c-3 (V0 §8.3) — the 3×3 content-position picker of a hero / banner. The grid is the pair
 * (`align`, `valign`): the inline axis is `start | center | end` (logical, so it mirrors under RTL — the first
 * column sits on the reading-start side), the block axis `start | center | end` = top | middle | bottom. A cell
 * sets both; "Automatic" clears both (the section lays out as it always did).
 *
 * Plain toggle buttons with `aria-pressed`, like the media focal grid: nine real tab stops, no custom keyboard model.
 */
export function PlacementGrid({
  align,
  valign,
  t,
  onChange,
}: {
  align: Align | undefined;
  valign: Align | undefined;
  t: T;
  onChange: (next: { align: Align | undefined; valign: Align | undefined }) => void;
}) {
  const automatic = align === undefined && valign === undefined;
  return (
    <Field label={t("designBlockAlign")}>
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <div
            role="group"
            aria-label={t("designBlockAlign")}
            className="grid w-fit grid-cols-3 gap-1"
            data-design-placement=""
          >
            {ALIGNS.flatMap((row, r) =>
              ALIGNS.map((col, c) => {
                const active = align === col && valign === row;
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${t(ROWS[r])} ${t(COLS[c])}`}
                    data-placement-cell={`${row}-${col}`}
                    onClick={() => onChange({ align: col, valign: row })}
                    className={`flex size-11 items-center justify-center border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:size-9 ${
                      active ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-background"
                    }`}
                  >
                    <span aria-hidden="true" className={`size-2 rounded-full ${active ? "bg-primary" : "bg-border"}`} />
                  </button>
                );
              }),
            )}
          </div>
          <button
            type="button"
            data-placement-reset=""
            className={`${btnClass} h-10 gap-1.5`}
            disabled={automatic}
            onClick={() => onChange({ align: undefined, valign: undefined })}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {t("designUnset")}
          </button>
        </div>
        <p className="text-[12px] leading-5 text-muted">{t("designPlacementHint")}</p>
      </div>
    </Field>
  );
}
