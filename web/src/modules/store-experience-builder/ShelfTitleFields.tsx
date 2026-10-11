"use client";

/**
 * CUST-HV V9d-3 (V0 §14.2) — the optional title and "show title" of a product / offer shelf. Presentation copy only:
 * nothing here names, prices or selects products. A blank title falls back to the localized default; hiding the
 * title keeps it as the section's accessible name.
 */

import { BufferedText } from "./BufferedText";
import { Field, Toggle } from "./ControlPanels";
import type { CustomizerMessageKey } from "./messages";
import { MAX_SECTION_TITLE_LENGTH, type ShelfTitle } from "./presentation/section-content";

type T = (key: CustomizerMessageKey) => string;

export function ShelfTitleFields({
  content,
  t,
  onChange,
}: {
  content: ShelfTitle;
  t: T;
  onChange: (next: ShelfTitle) => void;
}) {
  const title = content.title ?? "";
  const shown = content.showTitle !== false;
  const emit = (nextTitle: string, nextShown: boolean) => {
    const out: ShelfTitle = {};
    if (nextTitle.trim() !== "") out.title = nextTitle;
    if (!nextShown) out.showTitle = false;
    onChange(out);
  };
  return (
    <div className="space-y-2" data-shelf-title-fields="">
      <Field label={t("shelfTitleLabel")}>
        <BufferedText
          value={title}
          limit={MAX_SECTION_TITLE_LENGTH}
          placeholder={t("shelfTitlePlaceholder")}
          onCommit={(value) => emit(value, shown)}
          data-shelf-title=""
        />
      </Field>
      <Toggle label={t("shelfTitleShow")} checked={shown} onChange={(value) => emit(title, value)} />
      {!shown ? <p className="text-xs text-muted" data-shelf-title-hidden-note="">{t("shelfTitleHiddenNote")}</p> : null}
    </div>
  );
}
