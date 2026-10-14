# AWJ-PLATFORM-UX-H15-11 — Platform Heading Hierarchy Accessibility

Source finding: `AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md` row H15-11 (P3, pre-existing): axe `heading-order` (moderate) on tenants, tenant detail and integrations.
Scope: frontend only (`web/`). No Backend, API, DB, permission, tenant-isolation, data, link, translation or visual change.

## 1. Root cause

`CardTitle` (`components/ui/card.tsx`) always renders `<h3>`. On the three flagged pages the cards sit directly under the page `<h1>` with no `<h2>` in between, so the outline jumped h1 → h3 (and, on tenants/integrations, then returned to a sibling `<h2>`).

## 2. Fix

- `CardTitle` gets an optional `as` prop (`h1`–`h6`), **default `h3`**: every existing consumer (ERP, dashboard, prices, nested provider cards…) is untouched. Classes, `id` and `data-awj-card-title` are unchanged, so the look cannot depend on the level.
- Page-level card titles on the affected pages now declare `as="h2"`. Nested structure inside a card is kept (h3 sub-sections, h4 product rows).
- Nothing was hidden, removed or replaced by a non-semantic element.

## 3. Files changed

| File | Change |
|---|---|
| `web/src/components/ui/card.tsx` | `as` prop (default h3) |
| `web/src/components/platform/global-application-controls-card.tsx` | title `as="h2"` (tenants) |
| `web/src/app/platform/(console)/tenants/[id]/page.tsx` | 4 card titles `as="h2"` |
| `web/src/components/platform/contract-management-card.tsx` | 2 titles `as="h2"` |
| `web/src/components/platform/commercial-operations-card.tsx` | title `as="h2"` |
| `web/src/components/platform/application-override-card.tsx` | title `as="h2"` |
| `web/src/app/platform/(console)/integrations/page.tsx` | runtime-status title `as="h2"` |
| `web/src/components/platform/heading-outline.test.tsx` | new, 14 tests |

## 4. Heading outline, before → after (real Chromium, English; Arabic identical in structure)

| Page | Before | After |
|---|---|---|
| `/platform/tenants` | h1 Tenants · **h3** Global application controls · h2 Tenant list | h1 · **h2** Global application controls · h2 Tenant list |
| `/platform/tenants/:id` | h1 name · **h3** ×14 (Tenant details, Change plan, Trial management, Commercial contract management, Subscription contract history, Subscription & Applications, Products & applications, Included products, Legacy entitlements, Ended or cancelled assignments, Commercial assignment history, Access inspector, Application overrides, Access management) with h4 product rows | h1 · **h2** Tenant details, Change plan, Trial management, Commercial contract management, Subscription contract history, Subscription & Applications, Application overrides, Access management · h3 Products & applications, Included products, Legacy entitlements, Ended or cancelled assignments, Commercial assignment history, Access inspector · h4 product rows (under Products & applications) |
| `/platform/integrations` | h1 · **h3** Runtime status · h2 Storage… · h3 cards · h2 AI Providers · h3 providers | h1 · **h2** Runtime status · h2 Storage… · h3 cards · h2 AI Providers · h3 providers |
| `/platform`, `/platform/prices`, `/platform/document-operations` | already valid | unchanged (no axe finding before or after) |

Every section name, its text and its order are unchanged (AR and EN).

## 5. Verification

Real: local Laravel + Next dev, real login, Chromium (Playwright), axe-core 4.10.2 (not a web dependency). Mocked: only inside Vitest (network client and router).

| Check | Result |
|---|---|
| axe `heading-order` on the 3 pages, en/ar | before: present on all 3 in both languages; **after: none** |
| Full axe (wcag2a/aa, 2.1, 2.2 aa, best-practice), 6 platform routes × en/ar × 1280/390 × 100%/200% text = 48 loads | **no violations at all after** (before: only `heading-order`) |
| Geometry of every visible element at 100% text, 48 page states (6 routes × en/ar × light/dark × 1280/390), 32 928 elements | **0 moved, 0 resized, 0 added, 0 removed** |
| Same at 200% text (real browser font-size preference), 48 states, 32 908 elements | **identical** |
| Keyboard: real Tab walk, 40 stops × 3 pages × en/ar | **sequence identical before/after; 0 stops on a heading** |
| Vitest `heading-outline.test.tsx` | 14/14 |
| Mutation checks (revert each fix; break the `as` prop) | all 5 caught |
| Full web suite | 550 files / 6001 tests passed |
| `tsc --noEmit` | 48 errors = baseline on main |
| `next build` | exit 0 |

Regression tests cover: outline order and no skipped level on the three real pages (AR/EN); one h1; all sections present in order with the same text; `CardTitle` default h3 and identical classes/id/marker when `as` is set; headings are not tab stops; source guards that page-level titles declare `as="h2"` and that nothing was replaced by a non-semantic element. "Unchanged appearance at 100% / no regression at 200%" is proven by the real-browser geometry snapshots above, not by jsdom.

## 6. Build / CI

Filled in on the PR for the final head (see PR description and checks).

## 7. Risks and limits

- Not verified: real screen readers (NVDA/JAWS/VoiceOver/TalkBack), Firefox, WebKit, native browser zoom.
- Other `/platform` pages and the ERP were not audited beyond the six platform routes above; their axe results are unchanged.
- Sub-headings inside the cards that already used explicit `<h3>` (Commercial card sub-sections, product rows) keep their levels; they are correct under the new h2 parents.
- `Access management` heading text includes an inline "Sensitive action" label inside the heading (pre-existing; not changed here).
- `Card` consumers outside this scope keep h3 by default; any future page that places cards directly under an h1 must pass `as="h2"`.

## 8. Reviews

Implementer: self-review plus the mutation and real-browser checks above. Reviewer / AWJ Guardian: recorded on the PR.

## 9. Git

Base: `origin/main` @ `a94e15b870a739bc79abbac72f135f040aee64b2` (merge of H15-06, PR #1406). Branch `claude/awj-h15-11-heading-order`.
No merge, deploy, production release or closing of the H1 Horizon without Safwan's explicit approval.
