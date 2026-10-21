import type { CustomizerMessageKey } from "./messages";
import {
  type Announcement,
  announcementWindowState,
} from "./presentation/announcements";

export type AnnouncementEditorStatus =
  | "live"
  | "bar_off"
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
  barEnabled = true,
): AnnouncementEditorStatus {
  if (!item.enabled) return "disabled";
  if (item.text.trim() === "") return "empty";
  const window = announcementWindowState(item.window, nowMs);
  if (window !== "open") return window;
  // The storefront shows nothing while the master switch is off, so a message
  // that would otherwise be live must not claim to be.
  return barEnabled ? "live" : "bar_off";
}

const ISSUE_KEY: Record<string, CustomizerMessageKey> = {
  announcement_text_required: "annIssueTextRequired",
  window_end_not_after_start: "annIssueWindowOrder",
  window_invalid_timestamp: "annIssueWindowInvalid",
  contrast_insufficient: "annIssueContrast",
};
const MAX_LISTED_ISSUES = 3;

const MEDIA_ISSUE_KEY: Record<string, CustomizerMessageKey> = {
  media_missing: "mediaIssue_media_missing",
  media_not_ready: "mediaIssue_media_not_ready",
  alt_required_ar: "mediaIssue_alt_required_ar",
  alt_required_en: "mediaIssue_alt_required_en",
  transform_invalid: "mediaIssue_transform_invalid",
  derivative_not_ready: "mediaIssue_derivative_not_ready",
  derivative_failed: "mediaIssue_derivative_failed",
  animated_transform_unsupported: "mediaIssue_animated_transform_unsupported",
  animated_not_allowed_here: "mediaIssue_animated_not_allowed_here",
};

/** Which identity slot a `branding.*Media…` path belongs to. */
function mediaSlotLabel(
  path: string,
  t: (key: CustomizerMessageKey) => string,
): string | null {
  if (path.startsWith("branding.compactLogoMedia")) return t("compactLogo");
  if (path.startsWith("branding.logoMedia")) return t("logo");
  if (path.startsWith("branding.faviconMedia")) return t("favicon");
  return null;
}

/**
 * One merchant sentence for a publish-gate rejection: which message / image,
 * what to fix. Unknown codes fall back to the generic headline — never raw
 * server text or a code string.
 */
export function describePublishIssues(
  issues: Record<string, string>,
  t: (key: CustomizerMessageKey) => string,
): string | null {
  const lines: string[] = [];
  const bannerLines: string[] = [];
  const mediaLines: string[] = [];
  let backgroundBlocked = false;
  let gradientBlocked: CustomizerMessageKey | null = null;
  let sectionTextBlocked = false;
  for (const [path, code] of Object.entries(issues)) {
    if (path.startsWith("announcements")) {
      const key = ISSUE_KEY[code];
      const index = /items\[(\d+)\]/.exec(path)?.[1];
      lines.push(
        `${index === undefined ? "" : `${t("annMessageLabel")} ${Number(index) + 1}: `}${key ? t(key) : t("annPublishBlocked")}`,
      );
      continue;
    }
    if (/^homepage\.sections\[\d+\]\.content\.window\./.test(path)) {
      const key = ISSUE_KEY[code];
      const index = /sections\[(\d+)\]/.exec(path)?.[1];
      bannerLines.push(
        `${t("bannerLabel")}${index === undefined ? "" : ` ${Number(index) + 1}`}: ${key ? t(key) : t("bannerPublishBlocked")}`,
      );
      continue;
    }
    // P3-A-05 — the temporary server gate on global image backgrounds (until P3-A-06): say what to do,
    // not a generic "publish failed". The gate itself stays server-side; this only explains it.
    if (path === "background" && code === "global_media_background_not_ready") {
      backgroundBlocked = true;
      continue;
    }
    // P3-A-06 — the global gradient is judged by the contrast policy: each stable code has its own sentence.
    if (path === "background" && code === "global_gradient_contrast_insufficient") {
      gradientBlocked = "storeBackgroundGradientContrastBlocked";
      continue;
    }
    if (path === "background" && code === "global_gradient_colour_unresolved") {
      gradientBlocked = "storeBackgroundGradientUnresolvedBlocked";
      continue;
    }
    // …and a section's explicit text colour judged against the real page paint.
    if (code === "global_background_text_contrast_insufficient") {
      sectionTextBlocked = true;
      continue;
    }
    const mediaKey = MEDIA_ISSUE_KEY[code];
    if (mediaKey) {
      const slot = mediaSlotLabel(path, t);
      mediaLines.push(`${slot ? `${slot}: ` : ""}${t(mediaKey)}`);
    }
  }

  const parts: string[] = [];
  if (lines.length > 0) {
    const shown = lines.slice(0, MAX_LISTED_ISSUES).join(" · ");
    const more = lines.length - MAX_LISTED_ISSUES;
    parts.push(`${t("annPublishBlocked")}. ${shown}${more > 0 ? ` (+${more})` : ""}`);
  }
  if (bannerLines.length > 0) {
    const shown = bannerLines.slice(0, MAX_LISTED_ISSUES).join(" · ");
    const more = bannerLines.length - MAX_LISTED_ISSUES;
    parts.push(`${t("bannerPublishBlocked")}. ${shown}${more > 0 ? ` (+${more})` : ""}`);
  }
  if (mediaLines.length > 0) {
    const shown = mediaLines.slice(0, MAX_LISTED_ISSUES).join(" · ");
    const more = mediaLines.length - MAX_LISTED_ISSUES;
    parts.push(`${t("mediaPublishBlocked")}. ${shown}${more > 0 ? ` (+${more})` : ""}`);
  }
  if (backgroundBlocked) parts.push(t("storeBackgroundPublishBlocked"));
  if (gradientBlocked) parts.push(t(gradientBlocked));
  if (sectionTextBlocked) parts.push(t("storeBackgroundSectionTextBlocked"));
  return parts.length === 0 ? null : parts.join(" ");
}
