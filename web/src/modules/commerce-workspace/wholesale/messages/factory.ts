/**
 * Typed ar/en message dictionaries for the Wholesale Merchant Workspace.
 *
 * Each section owns one dictionary built with {@link defineMessages}: the English dictionary is typed against the
 * Arabic keys, so a missing or extra key is a compile error and `expectMessageParity` (messages.test helpers)
 * guards empty values. Server values we do not know are shown verbatim by `label()` — never invented.
 */

export type MessageVars = Record<string, string | number>;

export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function defineMessages<A extends Record<string, string>>(ar: A, en: Record<keyof A, string>) {
  type Key = keyof A & string;
  const messages = { ar, en } as const;

  function forLocale(locale: string) {
    const dict: Record<string, string> = locale === 'en' ? en : ar;
    const t = (key: Key, vars?: MessageVars): string => interpolate(dict[key] ?? key, vars);
    /** `prefix.value` lookup for server enums; unknown/empty values fall back to the raw value or a dash. */
    const label = (prefix: string, value: string | null | undefined): string => {
      if (value === null || value === undefined || value === '') return '—';
      const key = `${prefix}.${value}`;
      return key in dict ? dict[key] : value;
    };
    return { t, label };
  }

  return { messages, forLocale };
}
