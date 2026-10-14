# AC-UX-HZ-01 — Task Queue

Execution tracking only. Scope definitions: [`AC-UX-HZ-01-MASTER-PLAN.md`](./AC-UX-HZ-01-MASTER-PLAN.md). Facts: [`AC-UX-HZ-01-CURRENT-STATE.md`](./AC-UX-HZ-01-CURRENT-STATE.md).

Legend: ☐ not started · ◐ in progress / in review · ☑ merged (with Merge SHA). A box is ticked only after tests + exact-head CI + squash merge.

| # | Slice | Depends on | Status | PR | Base SHA | Merge SHA |
|---|---|---|---|---|---|---|
| 00 | Baseline inspection + execution docs + doc corrections | — | ☑ | #1460 | `5ff3135` | `58582ce` |
| 00A | **User Administration Grant Boundaries** — backend fix for F-1/F-2 (High, owner decision Option 2): scope ceiling, role grant ceiling, target ceiling (role + scope), `roles.manage` role-definition ceiling (D-I) + negative tests. **Blocks 01, 03A, 03B, 04** (any UI that mutates users or roles). | 00 | ☑ | #1462 | `5ff3135` | `f1b7031` |
| 01 | Users workspace V2 (route `/users`, permission-gated nav, **own manage gating: view-only viewers get a read-only table**, D-H role-name fallback, D-D scale mitigation, filters, status, lifecycle confirmations, mobile cards, error states, `/hr?tab=users` redirect) | 00, **00A** | ☑ | #1465 | `f1b7031` | `cc30b53` |
| 02 | User editor Sheet (identity · status · role · branch/warehouse scope as explicit All/Selected · pre-save access summary · dirty-state guard · diff-only payload; owner-user select fix) | 01 | ☑ | #1466 | `cc30b53` | `8c9f411` |
| 03A | Roles workspace shell + catalogue (route `/roles`, **`roles.manage` gating of create/edit/delete from the first slice**, master/detail, grouped read-only catalogue, i18n coverage for all 36 modules / 40 actions, `/hr?tab=roles` redirect) | 00, **00A** | ◐ | | `8c9f411` | |
| 03B | Role editing (**editors only for `roles.manage`; view-only viewers see the read-only catalogue**; selection model, group select/deselect, search, counts, risk map + drift test, dirty state, unsaved guard, system/owner messaging, "applies to N users") | 03A, **00A** | ☐ | | | |
| 04 | Role create + safe client-side clone (+ tests: source unchanged, only `name`+`permissions` sent) | 03B, **00A** | ☐ | | | |
| 05 | Shared scope editor + summary language (All/Selected, counts, search, warehouse↔branch context, limited-view notice) adopted in Users | 02 | ☐ | | | |
| 06 | Treasury deposit/withdraw access legibility on existing account form | 00 | ☐ | | | |
| 07 | Consolidate the capability helper (`useCan`-style over `lib/permissions.ts`, replacing the per-screen `hasPermission` calls from 01/03), extend to the rest of the ERP: hidden/read-only/disabled/allowed states on nav, create/edit/delete, posting, exports, reports, approvals, treasury, ZATCA, settings; `/me` refresh on shell mount/focus | 01, 03B | ☐ | | | |
| 08 | Per-user access summary (source assignments only) | 02, 05 | ☐ | | | |
| 09 | Keyboard / RTL / responsive (1440·1280·768·390) / dark+Ink / state QA with existing Playwright; add e2e for Users & Roles | 01–08 | ☐ | | | |
| 10 | Closure: backend regression matrix, frontend verification, final report | 09 | ☐ | | | |

## Open items carried by the queue

| ID | Item | Owner needed? | Notes |
|---|---|---|---|
| D-A | F-1 / F-2 backend containment | **Decided: Option 2 (owner, 2026-10-14), High** | Implemented by slice 00A, which blocks slice 01. |
| D-B | Permission metadata location | No (default adopted) | Revisit only if owner prefers an additive backend field. |
| D-D | Server-side pagination/search for `/users` | If an enterprise / `users: null` tenant grows large | API change; 01 ships client-side mitigation only. |
| D-I | `roles.manage` self-expansion | Decided: included in 00A (owner, 2026-10-14) | — |
| D-J | User-editor inputs gated by `roles.view`/`hr.view`/`branches.view`/`products.view` | No (per-input degradation, MASTER-PLAN §4.9) | Additive form-options lookup only on owner request. |
| D-H | Role display name for `users.view`-without-`roles.view` viewers | Only if the UI fallback proves inadequate | Additive `role_name` on `UserResource` would be non-breaking. |
| T-1 | Backend test for a scope-restricted actor calling `/users` (characterises F-1) | — | Delivered inside AC-UX-00A as negative tests of the new boundary (not as a test pinning the old behaviour). |

## Per-slice checklist (copy into each PR)

- [ ] Fresh `origin/main`; Base SHA recorded
- [ ] Scope == slice; no STOP condition triggered
- [ ] No migration · no API break · no authz weakening · tenant isolation intact
- [ ] i18n AR+EN complete · RTL logical props · v3 tokens only
- [ ] Loading / empty / no-results / error+retry
- [ ] Unit/component tests · affected backend suite (if backend contracts touched) · `npm run test` · `npm run build`
- [ ] Playwright for affected flows (from 01 onward)
- [ ] Screenshots reviewed: AR desktop, EN desktop, AR mobile, dark (not committed)
- [ ] Implementation report in PR · `NOT DEPLOYED`
- [ ] Exact-head CI green · no unresolved threads · mergeable
- [ ] Squash merge → record Merge SHA → update this table + CURRENT-STATE
