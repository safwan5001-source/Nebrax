# Nebrax UI Foundation — Phase 1 Prototype

## Goal
Build the first enforceable UI/UX foundation for Nebrax ERP without redesigning the whole product yet. This branch is prototype-only and must not be merged to `main` until explicit visual approval.

## Source of truth
Follow the existing Nebrax design system and repository conventions. Do not introduce a new visual language.

Core principles:
- ERP work tool: clarity, density, speed, trust.
- RTL-first Arabic; English LTR must remain correct.
- Light/dark support.
- IBM Plex Sans Arabic for UI text; IBM Plex Mono for financial numbers/codes.
- Use design tokens only (`bg-background`, `bg-surface`, `text-text`, `text-muted`, `border-border`, `bg-primary`, `bg-primary-soft`, semantic tones). No raw hex in components.
- No gradients, heavy shadows, decorative colored icon boxes, excessive animation.
- Default radius 8px; Dashboard may use 16px as an intentional exception.
- lucide-react icons, stroke 1.5–1.8.
- Semantic green/red/warning only for meaning, never decoration.
- Accessibility: visible focus, labels/ARIA, adequate contrast, status never by color alone.

## Architecture decision
One shared Nebrax UI language with three official workspace families:
1. ERP Workspace — normal accounting/admin pages.
2. Operational Workspace — Fuel Stations and future operational modules.
3. Full-screen Transaction Workspace — POS.

Do NOT force Fuel Stations or POS into the normal ERP shell. Reuse primitives and behavior, not identical page layouts.

## Phase 1 scope
Create reusable composition primitives, then demonstrate them on a small representative prototype. Do not mass-migrate pages.

### Foundation components
Prefer composition over rewriting existing primitives. Reuse current Button, Badge, Dialog, Table, DataTable, Data Explorer, etc.

Implement or refactor toward shared components such as:
- `NebraxPageHeader`
- `NebraxListToolbar`
- `NebraxPagination`
- standardized `LoadingState`, `EmptyState`, `ErrorState`
- responsive action grouping / overflow behavior
- improved mobile-record configuration for `DataTable`

Names may be adjusted to match repository conventions, but responsibilities must remain clear and reusable.

### Prototype pages
Apply the foundation only to representative pages sufficient for visual approval:
1. `/invoices` — ERP list page.
2. `/products` — second ERP list page to prove reuse and eliminate layout drift.
3. `/applications` — Settings-style page; preserve all entitlement/business logic.
4. `/fuel-stations` — Operational workspace sample; preserve its independent shell.

Do not redesign POS in this phase. POS remains a separate full-screen workspace and will be reviewed in a dedicated phase after the core language is approved.

## Required page anatomy — ERP list
1. Page header: title, context controls, primary/secondary actions.
2. Unified query/action bar: search, quick filters, advanced filters, sort/export when relevant.
3. Main data surface.
4. Unified result footer/pagination.
5. Standard dialog/state patterns.

### Desktop
- Dense, efficient ERP layout.
- Use width for comparison and tables.
- Avoid oversized cards.
- Financial numbers aligned to end and rendered with Mono.

### Mobile
Do not compress desktop tables.
Use a purposeful mobile record hierarchy:
- primary identifier/title
- key counterpart (customer/product/category)
- amount / most important metric
- status
- date/metadata
- compact actions

Avoid generic “every table cell becomes a labeled row” when a more useful mobile hierarchy can be defined.

### Tablet
Treat 768–1024 as a real layout state, not merely large mobile.

## Responsive verification matrix
Minimum widths:
- 360
- 390
- 430
- 768
- 1024
- 1280
- 1440+

Verify both RTL and LTR where practical, and light/dark.

## Functional safety
This phase is UI composition/refactor only.
Do not change:
- API contracts
- backend entitlement rules
- application enable/disable semantics
- accounting calculations
- numbering
- permissions/RBAC
- routing behavior
- Fuel Stations business logic

Preserve all existing tests and add focused tests for new shared behavior.

## Existing code observations to preserve/improve
- `web/src/components/data-table.tsx` already switches to mobile list under `md`; evolve this instead of replacing TanStack Table.
- `/invoices` and `/products` already use Data Explorer but differ in container/sort/pagination composition. Phase 1 should make these visually and structurally consistent via shared composition.
- `(app)` has the normal Sidebar/Topbar shell.
- `(fuel)` intentionally uses `FuelWorkspaceShell` independently.
- `(pos)` intentionally uses a full-screen layout and is out of scope for this prototype.

## Acceptance criteria
Before opening the prototype for approval:
- No raw hex introduced in components.
- No new gradients or heavy shadows.
- Shared composition is actually reused by `/invoices` and `/products`.
- Mobile has no page-level horizontal overflow.
- Primary actions remain reachable and obvious on phone.
- Keyboard focus states are visible.
- Loading/empty/error states remain explicit.
- Existing functional behavior remains intact.
- `npm` tests relevant to changed components/pages pass.
- production Next.js build passes.

## Deliverable
- Commit changes only on branch `ui-foundation-prototype`.
- Do not merge to `main`.
- Open a Draft PR when ready.
- Provide a Vercel Preview URL for visual review.
- Summarize changed shared components, migrated prototype pages, test/build results, and any intentional exceptions.

## Approval gate
No mass migration to the remaining Nebrax pages until the product owner explicitly approves the prototype after reviewing Desktop + Tablet + Mobile + light/dark.
