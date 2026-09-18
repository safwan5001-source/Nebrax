# CUSTOM-DOMAIN-EDGE-2 — Domain Activation UX — Implementation Report

## Status

**COMPLETE.** PR opened, not merged, not deployed.

EDGE-3 (custom Make Primary + provider-first Disconnect) is **not** in this slice.

## Git

- Latest `main` SHA used: `85e3dec6abd20e79707d2fcd68ddff90c4f9f3a9`
- Confirmed ancestor of CUSTOM-DOMAIN-EDGE-1 / PR #864 merge SHA `85e3dec6abd20e79707d2fcd68ddff90c4f9f3a9`
- Branch: `feat/custom-domain-edge-2-activation-ux`
- PR: [#867](https://github.com/safwan5001-source/Nebrax/pull/867)
- Base SHA: `85e3dec6abd20e79707d2fcd68ddff90c4f9f3a9`
- Head SHA: `a1cecf06653a683bbe46624299baf8914f78573c` at report time; CI counts from this SHA

`main` already included #864. Later storefront/visual commits on `main` were kept; EDGE-1 was not re-implemented.

## Architecture Authority

- Architecture PR: [#863](https://github.com/safwan5001-source/Nebrax/pull/863)
- EDGE-1 PR / merge: [#864](https://github.com/safwan5001-source/Nebrax/pull/864) `85e3dec6abd20e79707d2fcd68ddff90c4f9f3a9`
- Document: `docs/plans/store/AWJ_CUSTOM_DOMAIN_EDGE_TLS_ARCHITECTURE.md` §22 / §27 EDGE-2
- EDGE-1 report: `docs/plans/store/CUSTOM-DOMAIN-EDGE-1-IMPLEMENTATION-REPORT.md`

## Existing Backend Contract Reused

Zero backend production changes.

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/commerce/workspace/storefronts/{id}/domains/{domainId}/activate-edge` | `{}` |
| `POST` | `/api/commerce/workspace/storefronts/{id}/domains/{domainId}/refresh-edge` | `{}` |

`presentDomain.edge` is mapped additively:

```
status, dns_instructions.records[{type,name,value}], checked_at, ready_at, last_error
```

AWJ-managed → `edge = null`. Unknown/missing custom `edge` maps fail-closed to `status: none` (never invented `ready`). Unknown status strings map to `failed`, not `ready`.

## UX State Machine

Custom domains, from authoritative fields only:

| Ownership | `edge.status` | UI |
|---|---|---|
| not verified | any | existing Verify Now + AWJ ownership TXT. **No Activate.** |
| verified | `none` | Ownership verified + Awaiting domain activation. **Activate Domain.** |
| verified | `pending` | Ownership verified + Processing. Refresh (Retry). No DNS/TLS success claim. |
| verified | `dns_required` | Ownership verified + DNS configuration required. Railway records + **Check DNS**. |
| verified | `tls_pending` | Ownership verified + Securing HTTPS. **Check HTTPS.** |
| verified | `ready` | Ownership verified + **HTTPS Ready** (+ `ready_at`). **No Make Primary.** |
| verified | `failed` | Ownership verified + Activation failed. `last_error` if present. Activate if no records, else Retry/refresh. |

AWJ-managed rows are unchanged (Make Primary when eligible). Disconnect remains custom-only with confirmation.

## Ownership vs Edge/TLS Separation

Two labeled DNS surfaces:

1. **Ownership verification TXT** — `_awj-verification.<hostname>` / `awj-domain-verification=<token>` (existing 1B-3A challenge). Shown while ownership is not verified.
2. **HTTPS DNS records** — exactly `edge.dns_instructions.records` after Activate. Copy explains they are separate from the AWJ ownership TXT.

`verification_status = verified` never renders as Ready / HTTPS Ready.

Only `edge.status = ready` may be presented as HTTPS Ready.

## DNS Instructions UX

- Records rendered only as returned by the backend. Empty/incomplete triples are dropped, not invented.
- Each record: Type, Name/Host, Value/Target, copy name, copy value.
- Copy writes the backend string unchanged (`navigator.clipboard.writeText`).
- Long values `break-all` + `dir="ltr"` + `font-mono`.
- Nested under the domains table (existing pattern). No second page.

## Activate Behavior

- Shown only when `commerce.manage` + custom + verified + active + (`none` or failed-without-records).
- `POST .../activate-edge` with `{}`.
- Duplicate click disabled (`Activating…`).
- Success replaces that row with the returned domain (no optimistic `ready`).
- Failure keeps the previous row and toasts a classified safe message (422/409/503/403/404).

## Refresh Behavior

- `dns_required` → Check DNS; `tls_pending` → Check HTTPS; `pending`/`failed`-with-records → Retry.
- `POST .../refresh-edge` with `{}`.
- No timer, no background loop, no aggressive poll.
- Success uses the returned domain. Failure preserves previous state.

## Loading / Error Behavior

- Per-domain busy flags. One domain’s 503 does not affect other rows.
- No whole-catalog loading flash on Activate/Refresh.
- No optimistic status transition.
- Disconnect / Make Primary / Add still reload the authoritative list (unchanged 1B-3B).

## Mobile / RTL

- Action buttons `flex-wrap`.
- DNS values wrap (`break-all`); copy buttons stay in the nested row (reachable, not in a horizontal-only scroller).
- Arabic default via existing `commerceWorkspaceMessage`. Technical DNS/hostname remain `dir="ltr"`.
- Table remains the primary surface.

## Localization AR/EN

New keys in `COMMERCE_WORKSPACE_MESSAGES` (identical key sets). Distinct terms:

| Concept | AR | EN |
|---|---|---|
| Ownership verified | تم التحقق من الملكية | Ownership verified |
| Activate Domain | تفعيل النطاق | Activate Domain |
| DNS required | يلزم إعداد DNS | DNS configuration required |
| Check DNS | التحقق من DNS | Check DNS |
| Securing HTTPS | جارٍ تأمين HTTPS | Securing HTTPS |
| Check HTTPS | التحقق من HTTPS | Check HTTPS |
| HTTPS Ready | HTTPS جاهز | HTTPS Ready |

`messages.test.ts` asserts AR/EN key parity and that HTTPS Ready ≠ Ownership verified.

## Security / Client Authority

Activate and Refresh send **empty bodies**. Tests assert the body has none of:

`tenant_id`, `edge_status`, `edge_provider_id`, `dns_instructions`, `certificate_status`.

Frontend never reads or writes Railway credentials. No `NEXT_PUBLIC_*` Railway env. Mapper ignores leaked `provider_id`.

Frontend gating is not a security boundary. Backend EDGE-1 remains the authority.

## Make Primary

**Custom remains unavailable**, including `edge.status = ready`.

`canMakeDomainPrimary` is still AWJ-managed + verified + active + not already primary.

Regression: `shows HTTPS Ready with ready_at and still no Make Primary for a custom domain`.

## Disconnect

**Unchanged from #861 / EDGE-1.** Custom non-primary → confirm → DELETE. No `release()`, no Railway call from the browser. Confirmation and failure-preserves-row tests remain green.

## Backend Changes

**NONE.** No migration, no schema, no Railway client, no route, no presenter change.

## Files Changed

Frontend:

- `web/src/modules/commerce-workspace/domains.ts`
- `web/src/modules/commerce-workspace/domains.test.ts`
- `web/src/modules/commerce-workspace/messages.ts`
- `web/src/modules/commerce-workspace/messages.test.ts`
- `web/src/app/(commerce)/commerce/domains/page.tsx`
- `web/src/app/(commerce)/commerce/domains/page.edge.test.tsx`

Docs:

- `docs/plans/store/CUSTOM-DOMAIN-EDGE-2-IMPLEMENTATION-REPORT.md`

No `app/`, `routes/`, `database/`, `storefront/` production files.

## Tests

Local Vitest (this environment):

| Suite | Result |
|---|---|
| `domains.test.ts` | **33 passed** |
| `messages.test.ts` | **5 passed** |
| `page.test.tsx` (1B-2 read-only) | **6 passed** |
| `page.manage.test.tsx` (1B-3A) | **6 passed** |
| `page.lifecycle.test.tsx` (1B-3B) | **7 passed** |
| `page.edge.test.tsx` (EDGE-2) | **11 passed** |
| commerce-workspace + domains pages | **85 passed** |

EDGE-2 page coverage includes: unverified / none / pending / dns_required / tls_pending / ready / failed; activate-edge empty body; refresh-edge empty body; duplicate click disabled; failure preserves row; exact DNS name/value; copy; custom ready has no Make Primary.

## TypeScript

`npx tsc --noEmit`: **zero errors in touched files**. Pre-existing errors remain in untouched POS/platform/documents/products/import-jobs tests.

## Build / CI

`next build` **compiled** `/commerce/domains`. The sandbox lint gate is polluted by pre-existing eslint errors in untouched print-templates/POS files (same class reported on earlier store PRs). Authoritative web build is GitHub `web-ci.yml`.

Recorded from PR [#867](https://github.com/safwan5001-source/Nebrax/pull/867) HEAD `a1cecf0`:

| Gate | Run | Result |
|---|---|---|
| `web build (Next.js)` + Vitest | [35386885148](https://github.com/safwan5001-source/Nebrax/actions/runs/35386885148) | **SUCCESS** — **278 files / 1888 tests passed**; Next.js compile succeeded |
| `php artisan test (L11, sqlite)` | [35386885132](https://github.com/safwan5001-source/Nebrax/actions/runs/35386885132) job [105735749965](https://github.com/safwan5001-source/Nebrax/actions/runs/35386885132/job/105735749965) | **SUCCESS** — **43 skipped, 4197 passed** (25755 assertions) |
| `php artisan test (L11, pgsql)` | [35386885132](https://github.com/safwan5001-source/Nebrax/actions/runs/35386885132) job [105735749645](https://github.com/safwan5001-source/Nebrax/actions/runs/35386885132/job/105735749645) | **SUCCESS** — **4240 passed** (25986 assertions), **0 failed, 0 skipped** |

Backend counts match EDGE-1 after the ICANN hostname fix (no backend files in this PR).

## Risks / Remaining

1. **EDGE-3 remains** — custom Make Primary still hidden even when HTTPS Ready. Disconnect still DB-only (Railway orphan until provider-first).
2. Dual TXT merchant confusion is now labeled in UI; merchants can still add the wrong record at their DNS host.
3. No background refresh. Stale `tls_pending` stays until the merchant clicks Check HTTPS.
4. Frozen ICANN PSL / apex rejection is EDGE-1 server-side; this slice does not change it.

## Scope Confirmation

- no EDGE-3
- no custom Make Primary
- no Disconnect provider release
- no migration/schema
- no Railway client change
- no backend production change
- no deploy
- no merge
- no accounting changes
- no unrelated refactor
- 1B-3A ownership TXT contract unchanged

## Recommended Next Action

1. Review and merge this PR independently.
2. Next slice: **EDGE-3** — Make Primary for custom iff live Railway `CERTIFICATE_STATUS_TYPE_VALID` (re-query); Disconnect Railway-then-DB.

Do not merge from this agent.
Do not deploy from this agent.
Do not start EDGE-3 from this agent.
