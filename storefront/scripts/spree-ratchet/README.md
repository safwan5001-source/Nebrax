# X6 — Spree dependency ratchet

Prevents the storefront from acquiring **new operational dependencies on Spree** while the existing ones are removed
(`docs/plans/store/AWJ_SPREE_EXIT_MIGRATION_PLAN.md`, contract: Master Horizon V1 §6.1).

Run: `pnpm check:spree-ratchet` (offline, no env, runs in `storefront-ci.yml`).

## What is measured (`baseline.json`)

| Category | Counts |
|---|---|
| `spree_value_imports` | Runtime imports from `@spree/*` — per specifier; also side-effect, `export … from`, `import()`, `require()` |
| `spree_type_imports` | Type-only imports from `@spree/*` — `import type`, inline `type` specifiers, `import("@spree/…").T` |
| `spree_client_access` | Uses of `getClient`, `getClientForSurface`, `getWholesaleClient`, `initSpreeNext`, `resetClient`, `withAuthRefresh` (and SDK `createClient`) — calls, renamed imports/destructured aliases, `ns.getClient()`, bare references. Declarations are not counted |
| `spree_wrapper_imports` | Imports of `@/lib/spree[/…]` (or a relative path to it) from outside `src/lib/spree` |
| `spree_env_reads` | `process.env.SPREE_*`, `process.env["SPREE_*"]`, `const { SPREE_* } = process.env`, aliases of `process.env`, `NEXT_PUBLIC_SPREE_*` |

Parsed with the TypeScript compiler API, so comments, string literals, template/JSX text are never counted.
Scanned: `src/**` plus root `next.config.*`/`middleware`/`proxy`/`instrumentation`/`sentry.*.config`.
Excluded: `__tests__/`, `*.test|spec.*`, `__mocks__`, `__fixtures__`, `fixtures/`, `e2e/`, `*.d.ts`, `src/app/dev/**`;
`docs/`, Markdown and `messages/` are outside the scanned roots. Exclusions are path-segment/suffix based —
a production file named `latest.ts` is still scanned.

## Rule

The check **fails** if, in any category, the total **or any single file** exceeds the baseline (a new file with
dependencies counts as growth from 0). Decreases pass and are reported.

Known limit: computed env keys (`process.env[name]`) and a helper re-exposed under an unrelated name through another
module are not detectable statically; the wrapper-import category covers the common bypass (importing the wrapper).

## Changing the baseline (always an explicit, reviewed diff)

- **Never edited by CI.** `--update` refuses to run when `CI` is set.
- **Tightening after removals** (the normal case): `pnpm spree-ratchet:update`, commit `baseline.json`; the diff must
  show only decreases.
- **Increase** (exceptional): needs the same command plus a PR justification approved by the owner; reviewers must
  treat any `+` line in `baseline.json` as a blocking question.
