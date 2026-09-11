# PR-COM-7-P0 — AWJ Spree Storefront Foundation — Implementation Report

## Identifiers

| Field | Value |
|-------|-------|
| PR | [#759](https://github.com/safwan5001-source/Nebrax/pull/759) |
| Branch | `claude/commerce-order-snapshots-o5m5i9` |
| Base SHA | `64402d2b0dc33dc6615d98583e900387a2683e0d` (main) |
| Head SHA | `19fb3d5f46833bcc9da43459c7108c10cf08f78e` |
| Upstream Spree Revision | `2ad6ad5bd1bcc055467064bd57cf20ab5f711c88` (2026-09-06) |

## Scope

Foundation-only adoption of Spree Storefront as AWJ Store's buyer-facing UI starting point. No cart, checkout, payment, shipping, or production tenant resolution.

## Deliverables

### 1. Spree Storefront Codebase (`/storefront`)

574 files added. Full Spree Storefront at pinned revision, isolated from `/web` (ERP app).

**AWJ modifications from upstream:**
- `.env.example` rewritten for AWJ defaults (country `sa`, locale `ar`, port 3001)
- `NOTICE` file with upstream attribution (repository, revision, license, copyright)
- Upstream `LICENSE` (MIT, Vendo Connect Inc.) preserved
- Removed: `e2e-backend/` (Docker Spree Rails backend), `CLAUDE.md` (Spree's own), `lefthook.yml`

### 2. Architecture Decision Documents (`docs/plans/store/`)

7 approved documents copied from planning branch `claude/spree-storefront-fit-audit-x8aar1`:

| Document | Purpose |
|----------|---------|
| `AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md` | `/storefront` isolation, hostname-based tenant resolution |
| `AWJ_COM_7_SPREE_INTEGRATION_GATE.md` | COM-7 phasing (P0-P5), keep vs replace decision |
| `AWJ_SPREE_TECHNICAL_FIT_AUDIT.md` | 23-row compatibility matrix, SDK coupling (91 files), recommendation |
| `AWJ_STORE_LANGUAGE_DECISION.md` | Arabic primary, English fully supported, RTL |
| `AWJ_STORE_DEFAULT_DESIGN_DIRECTION.md` | Spree as starting point, Tajawal font |
| `AWJ_COMMERCE_ADMIN_NAVIGATION_DECISION.md` | Commerce Workspace as command center |
| `AWJ_SPREE_ADMIN_SANDBOX_GAP_MAP.md` | Capability classification (AWJ-LINK / COMMERCE / BORROW-UX / GAP-V1 / LATER) |

### 3. CI Workflow (`.github/workflows/storefront-ci.yml`)

Triggers on `storefront/**` changes. Steps: pnpm install, Biome check, `tsc --noEmit`, vitest.

## Test Results

| Suite | Result | Details |
|-------|--------|---------|
| Storefront TypeScript | PASS | 0 errors (`tsc --noEmit`) |
| Storefront Biome | PASS | 271 files checked, 0 issues |
| Storefront Vitest | PASS | 34 test files, 247 tests |
| Laravel backend | PASS (no regression) | 3270 passed, 27 pre-existing failures in `FuelCostBasisService` (unrelated) |

## Build Status

`next build` fails because Spree's data layer uses `"use cache: remote"` directives that call the Spree API at build time (`localhost:8000`). No backend exists to serve these requests. This is **expected and documented** — the data layer will be replaced with AWJ Commerce endpoints in COM-7-P1.

TypeScript compilation (`tsc --noEmit`) passes cleanly, confirming the codebase is structurally sound.

## Risks

1. **API dependency at build time** — `next build` requires a live API. P1 must either replace the Spree SDK data layer or add error boundaries for build-time fetches.
2. **SDK coupling depth** — 91 files import `@spree/sdk`. Class A (catalog) is straightforward to replace. Class D (auth/checkout/payment) will be rebuilt fresh per AWJ ADRs.
3. **`pnpm-lock.yaml` size** — ~19K lines, standard for Next.js 16 + this dependency tree.
4. **Spree-internal CI workflow** — `storefront/.github/workflows/ci.yml` exists (Spree's own). It won't trigger from the monorepo root but should be removed or replaced in a future cleanup.

## What's Explicitly NOT Included

- Cart, checkout, payment, or shipping integration
- AWJ Commerce API endpoints
- Customer identity / auth integration
- Production tenant resolution (hostname-based)
- Full `next build` verification
- Deployment configuration
- Arabic locale messages (Spree ships en/de/es/fr/pl — Arabic will be added in P1)

## Next Steps

| Phase | Scope |
|-------|-------|
| COM-7-P1 | Replace Spree SDK data layer for catalog with AWJ Commerce API |
| COM-7-P2 | Customer identity (AWJ Customer Platform) |
| COM-7-P3 | Cart & checkout (rebuilt against AWJ ADRs) |
| COM-7-P4 | Payment integration (AWJ PaymentIntent model) |
| COM-7-P5 | Production deployment + tenant resolution |
