"use client";

import { useEffect, useState } from "react";
import { inputClass } from "./ControlPanels";

/** The text the stored form keeps (the normaliser trims heading / paragraph text with PHP's `trim` set). */
export function stored(value: string): string {
  return value.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, "");
}

/**
 * A text field whose stored form is trimmed: the draft is normalised on every keystroke, so a controlled value straight from the draft would
 * swallow every space typed at the end of a word. The field keeps what the merchant typed and only adopts the draft's value when it really
 * changed from elsewhere (another block selected, undo, a restored version).
 */
export function BufferedText({
  value,
  onCommit,
  multiline,
  limit,
  placeholder,
  normalize = stored,
  className,
  dir,
  inputMode,
  maxLength,
  ...rest
}: {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  /** The stored limit in Unicode code points (what the contract counts): the field never holds, or shows, what Save would drop. */
  limit?: number;
  placeholder?: string;
  /**
   * The draft's own normaliser for this field (default: the trim above). Pass a stable (module-level) function. The field adopts the draft's value only when it differs from
   * `normalize(typed)` — so a URL the draft drops while it is still half-typed (`h`, `https:/`), or a message the draft trims, never
   * rewrites what the merchant is typing.
   */
  normalize?: (typed: string) => string;
  /** Extra classes appended to the shared input style. */
  className?: string;
  dir?: "ltr" | "rtl";
  inputMode?: "url" | "text";
  maxLength?: number;
} & Record<`data-${string}`, string>) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal((current) => (normalize(current) === value ? current : value));
  }, [value]);
  const commit = (typed: string) => {
    // the limit is on the STORED (trimmed) form, so leading whitespace does not spend the quota
    const lead = typed.length - typed.replace(/^[ \t\n\r\0\v]+/, "").length;
    const points = limit === undefined ? null : Array.from(typed);
    const next = points && points.length > limit! + lead ? points.slice(0, limit! + lead).join("") : typed;
    setLocal(next);
    onCommit(next);
  };
  return multiline ? (
    <textarea
      className={`${inputClass} ${className ?? "h-24 py-2"}`}
      value={local}
      placeholder={placeholder}
      dir={dir}
      maxLength={maxLength}
      onChange={(event) => commit(event.target.value)}
      {...rest}
    />
  ) : (
    <input
      className={`${inputClass}${className ? ` ${className}` : ""}`}
      value={local}
      placeholder={placeholder}
      dir={dir}
      inputMode={inputMode}
      maxLength={maxLength}
      onChange={(event) => commit(event.target.value)}
      {...rest}
    />
  );
}
