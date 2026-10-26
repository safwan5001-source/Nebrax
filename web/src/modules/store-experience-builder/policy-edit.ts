import type {
  PresentationContentPage,
  PresentationPolicyContent,
  PresentationPolicyLocaleContent,
} from "./presentation/config";
import { POLICY_PAGE_SLUGS } from "./presentation/config";

/** B8-3 — pure helpers behind the merchant policy editor (mirror of the server's B8-1 limits). */
export const POLICY_TITLE_MAX = 80;
export const POLICY_BODY_MAX = 20000;
export const POLICY_LOCALES = ["ar", "en"] as const;
export type PolicyLocale = (typeof POLICY_LOCALES)[number];

export function isPolicyPage(page: PresentationContentPage): boolean {
  return POLICY_PAGE_SLUGS.includes(page.slug);
}

/** Code-point length, matching the server's `mb_strlen`. */
export function charCount(value: string): number {
  return Array.from(value).length;
}

export function policyLocaleContent(
  page: PresentationContentPage,
  locale: PolicyLocale,
): PresentationPolicyLocaleContent {
  return page.content?.[locale] ?? { title: "", body: "" };
}

export type PolicyStatus = "hidden" | "empty" | "ready";

/**
 * What a visitor would get once this DRAFT is published: `hidden` (page disabled ⇒ 404),
 * `empty` (enabled but no text in any language ⇒ 404), `ready` (enabled + text ⇒ served).
 * It describes the draft only — the live state needs a publish.
 */
export function policyStatus(page: PresentationContentPage): PolicyStatus {
  if (!page.enabled) return "hidden";
  const hasText = POLICY_LOCALES.some(
    (locale) => policyLocaleContent(page, locale).body.trim() !== "",
  );
  return hasText ? "ready" : "empty";
}

/** Returns the page with one field changed; empty locales/`content` are dropped so legacy documents stay byte-identical. */
export function withPolicyField(
  page: PresentationContentPage,
  locale: PolicyLocale,
  field: "title" | "body",
  value: string,
): PresentationContentPage {
  const next: PresentationPolicyContent = { ...(page.content ?? {}) };
  const current = policyLocaleContent(page, locale);
  const updated = { ...current, [field]: value };
  if (updated.title.trim() === "" && updated.body.trim() === "") {
    delete next[locale];
  } else {
    next[locale] = updated;
  }
  const { content: _drop, ...rest } = page;
  return Object.keys(next).length > 0 ? { ...rest, content: next } : rest;
}

export interface PolicyFieldIssue {
  locale: PolicyLocale;
  field: "title" | "body";
  over: number;
}

/** Live per-field overflow for one page (same rules the server enforces on save). */
export function policyFieldIssues(
  page: PresentationContentPage,
): PolicyFieldIssue[] {
  const issues: PolicyFieldIssue[] = [];
  for (const locale of POLICY_LOCALES) {
    const { title, body } = policyLocaleContent(page, locale);
    if (charCount(title) > POLICY_TITLE_MAX) {
      issues.push({ locale, field: "title", over: charCount(title) - POLICY_TITLE_MAX });
    }
    if (charCount(body) > POLICY_BODY_MAX) {
      issues.push({ locale, field: "body", over: charCount(body) - POLICY_BODY_MAX });
    }
  }
  return issues;
}

/** Parses a server 422 path like `pages.2.content.ar.body` (null when it is not a policy path). */
export function parsePolicyIssuePath(
  path: string,
): { index: number; locale: PolicyLocale; field: "title" | "body" } | null {
  const m = /^pages\.(\d+)\.content\.(ar|en)\.(title|body)$/.exec(path);
  return m
    ? { index: Number(m[1]), locale: m[2] as PolicyLocale, field: m[3] as "title" | "body" }
    : null;
}
