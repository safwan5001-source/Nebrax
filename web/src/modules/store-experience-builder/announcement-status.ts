import type { CustomizerMessageKey } from "./messages";
import {
  type Announcement,
  announcementWindowState,
} from "./presentation/announcements";

export type AnnouncementEditorStatus =
  | "live"
  | "disabled"
  | "empty"
  | "scheduled"
  | "expired"
  | "invalid";

/**
 * What the merchant should read next to a message in the list. Order matters:
 * a disabled message is "disabled" even if its window is also past, because
 * that is the first thing they can act on.
 */
export function announcementEditorStatus(
  item: Announcement,
  nowMs: number,
): AnnouncementEditorStatus {
  if (!item.enabled) return "disabled";
  if (item.text.trim() === "") return "empty";
  const window = announcementWindowState(item.window, nowMs);
  return window === "open" ? "live" : window;
}

const ISSUE_KEY: Record<string, CustomizerMessageKey> = {
  announcement_text_required: "annIssueTextRequired",
  window_end_not_after_start: "annIssueWindowOrder",
  window_invalid_timestamp: "annIssueWindowInvalid",
  contrast_insufficient: "annIssueContrast",
};
const MAX_LISTED_ISSUES = 3;

/**
 * One merchant sentence for a publish-gate rejection: which message, what to
 * fix. Unknown codes fall back to the generic headline — never raw server text
 * or a code string.
 */
export function describePublishIssues(
  issues: Record<string, string>,
  t: (key: CustomizerMessageKey) => string,
): string | null {
  const lines: string[] = [];
  for (const [path, code] of Object.entries(issues)) {
    if (!path.startsWith("announcements")) continue;
    const key = ISSUE_KEY[code];
    const index = /items\[(\d+)\]/.exec(path)?.[1];
    lines.push(
      `${index === undefined ? "" : `${t("annMessageLabel")} ${Number(index) + 1}: `}${key ? t(key) : t("annPublishBlocked")}`,
    );
  }
  if (lines.length === 0) return null;
  const shown = lines.slice(0, MAX_LISTED_ISSUES).join(" · ");
  const more = lines.length - MAX_LISTED_ISSUES;
  return `${t("annPublishBlocked")}. ${shown}${more > 0 ? ` (+${more})` : ""}`;
}
