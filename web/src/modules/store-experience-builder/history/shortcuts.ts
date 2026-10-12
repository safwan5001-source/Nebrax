/**
 * CUST-H5-2 — اختصارات لوحة المفاتيح للتراجع/الإعادة (§3.1) كدوال نقيّة قابلة للاختبار.
 *
 *  - Windows/Linux: تراجع `Ctrl+Z` · إعادة `Ctrl+Y` و`Ctrl+Shift+Z`.
 *  - macOS: تراجع `Cmd+Z` · إعادة `Cmd+Shift+Z`.
 *
 * ما لا يجوز أن يُسرق: التراجع/الإعادة الأصليان داخل أي عنصر نصّي قابل للتحرير (input نصّي/textarea/contenteditable/
 * combobox/textbox) — هناك للمتصفح سجلّه الخاص بالكتابة، ولسرقته يفقد التاجر ما كتبه للتوّ.
 */

export type HistoryShortcut = "undo" | "redo";

export interface ShortcutKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** حرف ASCII لاتيني؟ على تخطيطات غير لاتينية (عربي مثلاً) يكون `key` حرفاً آخر ويبقى `code` ثابتاً بموضع المفتاح. */
function isAsciiLetter(key: string): boolean {
  return /^[a-z]$/i.test(key);
}

function matchesLetter(event: ShortcutKeyEvent, letter: "z" | "y"): boolean {
  if (event.key.toLowerCase() === letter) return true;
  // تخطيط غير لاتيني: نعتمد موضع المفتاح الفيزيائي. على تخطيط لاتيني مختلف (Dvorak) يحسم `key` أعلاه.
  return !isAsciiLetter(event.key) && event.code === (letter === "z" ? "KeyZ" : "KeyY");
}

export function resolveHistoryShortcut(event: ShortcutKeyEvent, isMac: boolean): HistoryShortcut | null {
  if (event.altKey) return null;
  if (isMac) {
    if (!event.metaKey || event.ctrlKey) return null;
    if (matchesLetter(event, "z")) return event.shiftKey ? "redo" : "undo";
    return null;
  }
  if (!event.ctrlKey || event.metaKey) return null;
  if (matchesLetter(event, "z")) return event.shiftKey ? "redo" : "undo";
  if (matchesLetter(event, "y") && !event.shiftKey) return "redo";
  return null;
}

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

const EDITING_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

/**
 * هل الهدف عنصر يتوقع تراجعاً/إعادة أصليين؟ `input` غير النصّي (checkbox/range/radio/color/button) لا سجلّ نصّي له،
 * فيمرّ الاختصار منه إلى المحرِّر.
 */
export function isNativeEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = ((element as HTMLInputElement).type || "text").toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  if (element.isContentEditable) return true;
  const role = element.getAttribute?.("role");
  if (role && EDITING_ROLES.has(role)) return true;
  // داخل منطقة قابلة للتحرير (عنصر فرعي بلا تركيز مباشر).
  return Boolean(element.closest?.('[contenteditable=""], [contenteditable="true"]'));
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** نص الاختصار للعرض في الـ tooltip. */
export function shortcutHint(kind: HistoryShortcut, isMac: boolean): string {
  if (isMac) return kind === "undo" ? "⌘Z" : "⇧⌘Z";
  return kind === "undo" ? "Ctrl+Z" : "Ctrl+Y";
}

/** قيمة `aria-keyshortcuts` (الصيغة القياسية: Control/Meta بالاسم). */
export function ariaKeyShortcuts(kind: HistoryShortcut, isMac: boolean): string {
  if (isMac) return kind === "undo" ? "Meta+Z" : "Meta+Shift+Z";
  return kind === "undo" ? "Control+Z" : "Control+Y Control+Shift+Z";
}
