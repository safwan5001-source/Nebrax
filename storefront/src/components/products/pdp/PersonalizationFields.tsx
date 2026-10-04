"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  missingRequiredFields,
  type PersonalizationField,
} from "@/lib/commerce/pdp-gifting";
import { cn } from "@/lib/utils";

const controlClass =
  "w-full rounded-store border border-store-border bg-store-surface px-3 text-sm text-store-foreground placeholder:text-store-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary aria-invalid:border-store-destructive";

/**
 * FLOWERS-H11 — the merchant's customer-input fields for this product (ADR-16:
 * engraving text, a card line, a choice such as a vase colour). Controlled by
 * the PDP, which sends the answers with the cart line; the server re-validates
 * every answer (type, length, allowed option) and rejects what it does not
 * accept. Required fields are checked here only to save a round trip and to
 * point at the first gap — they are never the authority.
 */
export function PersonalizationFields({
  fields,
  values,
  onChange,
  showErrors,
}: {
  fields: readonly PersonalizationField[];
  values: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
  showErrors: boolean;
}) {
  const t = useTranslations("products");
  const baseId = useId();
  if (fields.length === 0) return null;
  const missing = new Set(missingRequiredFields(fields, values));

  return (
    <fieldset
      data-personalization=""
      className="mt-5 min-w-0 space-y-4 border-t border-store-border pt-5"
    >
      <legend className="mb-3 text-sm font-bold text-store-foreground">
        {t("personalizationTitle")}
      </legend>
      {fields.map((field) => {
        const id = `${baseId}-${field.key}`;
        const helpId = `${id}-help`;
        const errorId = `${id}-error`;
        const value = values[field.key] ?? "";
        const invalid = showErrors && missing.has(field.key);
        const describedBy =
          [field.helpText ? helpId : null, invalid ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined;
        return (
          <div key={field.key} data-personalization-field={field.key}>
            <label
              htmlFor={id}
              className="mb-1 flex items-baseline justify-between gap-2 text-sm font-semibold text-store-foreground"
            >
              <span>{field.label}</span>
              <span className="text-xs font-normal text-store-muted-foreground">
                {field.required
                  ? t("personalizationRequired")
                  : t("personalizationOptional")}
              </span>
            </label>
            {field.type === "select" ? (
              <select
                id={id}
                value={value}
                required={field.required}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={cn(controlClass, "min-h-11")}
              >
                <option value="">{t("personalizationChoose")}</option>
                {field.options.map((option) => (
                  <option key={option.valueKey} value={option.valueKey}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                id={id}
                value={value}
                rows={3}
                maxLength={field.maxLength ?? undefined}
                required={field.required}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={cn(controlClass, "py-2")}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={value}
                maxLength={field.maxLength ?? undefined}
                required={field.required}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={cn(controlClass, "min-h-11")}
              />
            )}
            <div className="mt-1 flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                {field.helpText ? (
                  <p
                    id={helpId}
                    className="text-xs text-store-muted-foreground"
                  >
                    {field.helpText}
                  </p>
                ) : null}
                {invalid ? (
                  <p
                    id={errorId}
                    role="alert"
                    className="text-xs font-medium text-store-destructive"
                  >
                    {t("personalizationFieldRequired")}
                  </p>
                ) : null}
              </div>
              {field.maxLength !== null && field.type !== "select" ? (
                <bdi className="shrink-0 text-xs text-store-muted-foreground">
                  {t("personalizationCount", {
                    count: value.length,
                    max: field.maxLength,
                  })}
                </bdi>
              ) : null}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
