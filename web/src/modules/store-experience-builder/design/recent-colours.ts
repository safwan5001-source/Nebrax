/**
 * CUST-HV V5d — the colours a merchant used recently, per browser (a convenience,
 * never part of the document). Storage may be blocked or empty: every access is
 * guarded and the field works without it.
 */
const KEY = "awj.customizer.recent-colours";
const MAX = 8;
const HEX = /^#[0-9a-f]{6}$/;

export function readRecentColours(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list
          .filter((c): c is string => typeof c === "string" && HEX.test(c))
          .slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function rememberColour(hex: string): string[] {
  const colour = hex.trim().toLowerCase();
  if (!HEX.test(colour)) return readRecentColours();
  const next = [colour, ...readRecentColours().filter((c) => c !== colour)].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the in-memory list below still serves this session */
  }
  return next;
}
