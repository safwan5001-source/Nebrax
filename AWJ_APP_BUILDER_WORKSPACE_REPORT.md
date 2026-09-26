# AWJ App Builder Dedicated Workspace Report

## Root cause

App Builder was physically located under `web/src/app/(app)/app-builder`, so every App Builder route inherited `web/src/app/(app)/layout.tsx` (`AppLayout`). That layout renders the AWJ ERP `Sidebar`, `Topbar`, `DemoBanner`, padded scrolling `<main>`, and `BranchScope`.

Build Store Experience follows a different composition: `web/src/app/(commerce)/layout.tsx` owns `CommerceWorkspaceShell`, while `web/src/components/commerce-workspace/commerce-workspace-shell.tsx` explicitly detects `/commerce/appearance` and returns a full-bleed, chrome-less surface. App Builder did not have that route-group composition and its editor also compensated for the ERP shell with `-m-4 sm:-m-6` and `h-[80vh]`.

## Base SHA

`c1bdac3b3f1f7f5be7cfde6b918671d0cb7814e1`

## Branch

`fix/app-builder-dedicated-workspace`

## PR

[PR #1059](https://github.com/safwan5001-source/Nebrax/pull/1059). No merge or deploy was performed.

## Route/layout before and after

| Surface | Before | After |
|---|---|---|
| `/app-builder` | `(app)/layout.tsx` → AWJ `AppLayout` → App Manager | `(commerce)/layout.tsx` → `CommerceWorkspaceShell` → App Manager; Commerce placement and link are preserved |
| `/app-builder/new` | `(app)/layout.tsx` → AWJ ERP shell | `(commerce)/layout.tsx` → Commerce shell |
| `/app-builder/[id]` | `(app)/layout.tsx` → AWJ ERP shell | `(commerce)/layout.tsx` → Commerce shell |
| `/app-builder/[id]/versions` | `(app)/layout.tsx` → AWJ ERP shell | `(commerce)/layout.tsx` → Commerce shell |
| `/app-builder/[id]/builder` | AWJ ERP shell plus compensating negative margins and fixed `80vh` editor | `(commerce)/layout.tsx` → `CommerceWorkspaceShell` detects the builder route and returns a full-bleed `100dvh` surface with no Commerce or AWJ navigation chrome; editor uses `h-full min-h-0` |
| `/commerce/appearance` | `(commerce)/layout.tsx` → existing chrome-less Store Experience pattern | Unchanged |

## Files changed

- `web/src/app/(commerce)/app-builder/**` — route-group move from `(app)`; route URLs and deep-link paths are unchanged.
- `web/src/components/commerce-workspace/commerce-workspace-shell.tsx` — adds the App Builder editor route predicate and chrome-less full-bleed return path.
- `web/src/components/commerce-workspace/commerce-workspace-shell.test.tsx` — adds a regression test proving App Builder has no Commerce navigation chrome.
- `web/src/app/(commerce)/app-builder/[id]/builder/page.tsx` — uses the available viewport, derives `dir` from locale, and adds a visible `Back to Commerce` action.
- `web/src/messages/en.json` — adds `appBuilder.builder.backToCommerce`.
- `web/src/messages/ar.json` — adds `appBuilder.builder.backToCommerce`.
- `AWJ_APP_BUILDER_WORKSPACE_REPORT.md` — this report.

## How App Builder is separated from AWJ ERP shell

The route tree is moved from the `(app)` route group into `(commerce)`, so it no longer mounts `AppLayout` and therefore no longer inherits the AWJ main Sidebar/Topbar. The editor route is then treated like the existing Store Experience Builder full-bleed surface: `CommerceWorkspaceShell` returns only the content main and the builder itself fills it with `h-full min-h-0`.

The editor retains its own builder header (save, publish, preview/device controls, app-level back action) and now has an explicit Commerce return link. No builder component, API call, data contract, database schema, native runtime, release/update architecture, or permission check was changed.

## Store Experience Builder pattern

Yes, the same route/layout pattern was used where appropriate:

- both editor surfaces are hosted under `(commerce)`;
- both are detected at the shell boundary;
- both render a chrome-less `100dvh` full-bleed surface;
- both preserve their own feature-specific header and panels.

They remain independent tools. App Builder was not merged with `ExperienceBuilder` or any Store Experience component.

## RBAC / Tenant Isolation impact

- **RBAC:** unchanged. Existing `hasAppBuilderPermission` checks remain in App Manager and editor pages, and backend `/api/app-builder/*` middleware was not modified.
- **Tenant isolation:** unchanged. Existing API calls, active branch/session context, tenant-scoped backend authorization, and store-design sync behavior were not modified.
- **Commerce capability gating:** unchanged. The existing Commerce nav entry remains at `/app-builder` with `commerce.app_builder` and `apps_builder.view` visibility rules.
- **Deep links:** route URLs remain identical (`/app-builder`, `/app-builder/new`, `/app-builder/:id`, `/app-builder/:id/versions`, `/app-builder/:id/builder`). Only the Next route-group composition changed.
- **RTL/LTR:** the editor now uses the active locale (`ar` → `rtl`, otherwise `ltr`) instead of hard-coding RTL. Root HTML direction remains supplied by the existing root layout.

## BranchScope verification

The route-group move intentionally does **not** add `BranchScope` to `CommerceLayout` or App Builder.

- Before the change, `AppLayout` mounted `BranchScope` around `(app)` children and also used `useBranchVersion` for ERP-shell state.
- After the change, no App Builder file under `web/src/app/(commerce)/app-builder` or `web/src/modules/app-builder` imports or references `BranchScope`, `useBranchVersion`, or `BRANCH_CHANGED_EVENT`.
- Every App Builder data request uses the shared `api()` helper (`/app-builder/apps`, drafts, registries, validation, and versions). `api()` reads `localStorage.getItem('nibras_active_branch')` at request time and adds `X-Branch-Id` when present.
- Therefore App Builder does not rely on the old wrapper to select or update branch context. Branch selection remains a shared request concern, and no wrapper or branch behavior was changed.
- Existing branch resolution tests passed: **8/8** (`branch.test.ts`, `branch-view.test.ts`).

## Tests / results

- Focused App Builder editor tests: **passed — 30 tests**.
- Commerce workspace shell tests: **passed — 9 tests**, including the new no-chrome App Builder regression.
- Commerce navigation tests: **passed — 10 tests** (`nav.test.ts` and `commerce-workspace-nav.test.ts`).
- JSON validation for `en.json` and `ar.json`: **passed**.
- `git diff --check`: passed before commit.
- Branch context tests: **passed — 8 tests**.

## Build / CI

- `pnpm run build`: **passed** (`next build`; compiled, lint/type validity for production build, generated 175 static pages).
- The generated route table includes `/app-builder`, `/app-builder/[id]`, `/app-builder/[id]/builder`, `/app-builder/[id]/versions`, and `/app-builder/new`.
- Standalone `pnpm exec tsc --noEmit` reports **12 pre-existing errors in 9 unrelated test files** (POS configuration, platform integrations, document/product tests, and import jobs). None reference the changed files; the production Next build passed its own validity step.
- GitHub PR CI: **passed — all checks green on PR #1059**. This includes the Web CI Next.js build and the PHP test matrix (SQLite and PostgreSQL jobs).

## Risks / remaining work

- The App Manager and creation/version routes remain inside the Commerce workspace shell rather than the full-bleed editor surface. This is intentional: only the actual builder editor needs maximum canvas/panel space, while list/detail/form pages retain normal Commerce navigation and clear escape routes.
- The new route predicate intentionally targets `/app-builder/:id/builder` (with an optional trailing slash), avoiding accidental chrome removal from App Manager, detail, version, and creation routes.
- Browser QA: **manual QA pending**. The local server was reachable and the unauthenticated Commerce → App Builder navigation redirected to the login screen as expected. A demo-session attempt could not be completed because the Browser tool session reset/unavailable; no authenticated Arabic/English builder interaction was claimed as passed.
- The existing unrelated TypeScript test errors should be addressed separately; they were not expanded in this PR.

## Head SHA

`931dda237f8ee063c8208587e5a8845360532712`

## Suggested next step

Review the PR and run the authenticated Commerce → App Builder → open builder flow in a staging/preview environment in both Arabic and English, then merge only after the normal CI checks and browser QA pass. Deployment is intentionally not performed by this task.
