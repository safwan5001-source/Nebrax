"use client";

import { useEffect, useId, useState } from "react";
import type { CustomizerMessageKey } from "../messages";
import { COLOR_ROLES, type ColorRef } from "../presentation/section-design";
import { resolveRoleHex } from "../presentation/palette";
import type { DesignContext } from "../presentation/section-design-resolve";
import { isSafeHexColor } from "../presentation/tokens";
import { HEX_PLACEHOLDER, PICKER_FALLBACK_HEX } from "./constants";
import { readRecentColours, rememberColour } from "./recent-colours";

const ROLE_LABEL: Record<(typeof COLOR_ROLES)[number], CustomizerMessageKey> = {
  brand: "designRoleBrand",
  accent: "designRoleAccent",
  surface: "designRoleSurface",
  surfaceAlt: "designRoleSurfaceAlt",
  text: "designRoleText",
  heading: "designRoleHeading",
  link: "designRoleLink",
  border: "designRoleBorder",
  overlay: "designRoleOverlay",
};

/** What a colour reference resolves to right now (role → palette → today's token). */
export function resolveColourRef(ref: ColorRef, ctx: DesignContext): string {
  return "role" in ref ? resolveRoleHex(ref.role, ctx) : ref.hex;
}

export interface ColourFieldProps {
  label: string;
  value: ColorRef | undefined;
  onChange: (next: ColorRef | undefined) => void;
  ctx: DesignContext;
  t: (key: CustomizerMessageKey) => string;
  /** Shown as the value when nothing is set (e.g. the automatic foreground). */
  automatic?: { hex?: string; label: string };
  /** Allow removing the colour (back to automatic / none). */
  clearable?: boolean;
  disabled?: boolean;
  /** Verdict line rendered under the field (contrast badge). */
  status?: { tone: "ok" | "bad"; text: string } | null;
  /** One-tap fix offered when the verdict is bad. */
  suggestion?: { label: string; onApply: () => void } | null;
  /** Hex only (no role swatches): used where the colour *defines* a role. */
  hexOnly?: boolean;
  dataName?: string;
}

/**
 * Role swatches + hex + recent colours. A role is a *reference* (it follows the
 * palette when the merchant retunes it); a hex is a fixed colour. Never a CSS string.
 */
export function ColourField({
  label,
  value,
  onChange,
  ctx,
  t,
  automatic,
  clearable = true,
  disabled = false,
  status = null,
  suggestion = null,
  hexOnly = false,
  dataName,
}: ColourFieldProps) {
  const id = useId();
  const resolved = value ? resolveColourRef(value, ctx) : (automatic?.hex ?? null);
  const [draft, setDraft] = useState(value && "hex" in value ? value.hex : "");
  const [recent, setRecent] = useState<string[]>([]);
  const draftInvalid = draft !== "" && !isSafeHexColor(draft.trim());

  useEffect(() => {
    setRecent(readRecentColours());
  }, []);
  useEffect(() => {
    setDraft(value && "hex" in value ? value.hex : "");
  }, [value]);

  const pickHex = (hex: string) => {
    const colour = hex.trim().toLowerCase();
    if (!isSafeHexColor(colour)) return;
    setRecent(rememberColour(colour));
    onChange({ hex: colour });
  };

  return (
    <div data-colour-field={dataName} className="space-y-2" aria-disabled={disabled || undefined}>
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-label`} className="text-[12px] font-medium text-muted">
          {label}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span
            aria-hidden="true"
            className="inline-block size-4 rounded-sm border border-border"
            style={resolved ? { backgroundColor: resolved } : undefined}
          />
          <span dir="ltr" data-colour-current="">
            {value
              ? "role" in value
                ? t(ROLE_LABEL[value.role])
                : value.hex
              : (automatic?.label ?? t("designColourNone"))}
          </span>
          {clearable && value ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(undefined)}
              className="px-1 text-muted underline hover:text-text disabled:opacity-50"
            >
              {t("designColourClear")}
            </button>
          ) : null}
        </span>
      </div>

      <div role="group" aria-labelledby={`${id}-label`} hidden={hexOnly} className="flex flex-wrap gap-1.5">
        {(hexOnly ? [] : COLOR_ROLES).map((role) => {
          const hex = resolveRoleHex(role, ctx);
          const selected = !!value && "role" in value && value.role === role;
          return (
            <button
              key={role}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`${t(ROLE_LABEL[role])} ${hex}`}
              title={`${t(ROLE_LABEL[role])} · ${hex}`}
              data-colour-role={role}
              onClick={() => onChange({ role })}
              className={`size-9 rounded-sm border-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50 ${
                selected ? "border-primary" : "border-border hover:border-muted"
              }`}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="color"
          disabled={disabled}
          aria-label={t("designColourPick")}
          value={isSafeHexColor(draft.trim()) ? draft.trim().toLowerCase() : (resolved && isSafeHexColor(resolved) ? resolved : PICKER_FALLBACK_HEX)}
          onChange={(event) => pickHex(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer border border-border bg-surface p-0.5 disabled:opacity-50"
        />
        <input
          dir="ltr"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          aria-label={t("designColourHex")}
          aria-invalid={draftInvalid || undefined}
          aria-describedby={draftInvalid ? `${id}-err` : undefined}
          placeholder={HEX_PLACEHOLDER}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (isSafeHexColor(event.target.value.trim())) pickHex(event.target.value);
          }}
          className="h-9 min-w-0 flex-1 border border-border bg-surface px-2 text-sm text-text outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        />
      </div>
      {draftInvalid ? (
        <p id={`${id}-err`} role="alert" className="text-[12px] text-negative">
          {t("designColourInvalid")}
        </p>
      ) : null}

      {recent.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">{t("designColourRecent")}</span>
          {recent.map((hex) => (
            <button
              key={hex}
              type="button"
              disabled={disabled}
              aria-label={hex}
              title={hex}
              data-colour-recent={hex}
              onClick={() => pickHex(hex)}
              className="size-7 rounded-sm border border-border outline-none hover:border-muted focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      ) : null}

      {status ? (
        <div
          data-colour-status={status.tone}
          role={status.tone === "bad" ? "alert" : "status"}
          className={`flex flex-wrap items-center gap-2 text-[12px] leading-5 ${
            status.tone === "bad" ? "text-negative" : "text-positive"
          }`}
        >
          <span>{status.text}</span>
          {suggestion ? (
            <button
              type="button"
              disabled={disabled}
              onClick={suggestion.onApply}
              className="border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-text hover:bg-background"
            >
              {suggestion.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
