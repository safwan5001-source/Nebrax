# IMP-H8-S1 — Import Hub `/imports` (UI)

**Branch:** `claude/imp-h8-s1-import-hub`. **Web only:** no backend, migration, permission, env or ZATCA change. **No journal entries** — the hub is a navigation map plus a read-only history; it uploads and writes nothing. Every entity leads to its own existing wizard with its own gates.

## Visual / product research (Horizon protocol)
Method: public help pages opened in a headless browser; screenshots of the UI images embedded in the vendors' own help articles viewed directly. Authenticated product screens were not reachable, so what follows is limited to what those public sources show. Odoo's docs returned 403, Zoho's and QuickBooks' help UI images did not load/resolve in this environment (their pages were read as text through search), Xero redirected to login.

| Source | What was actually seen / read | Kind |
|---|---|---|
| HubSpot «Monitor your imports & syncs» (screenshot viewed) | One page, tabs (File imports · App syncs · …), filter chips (system, source, user, date), a search box, a dense table: name with status dot, new / updated / errors counts, system, source; row opens a **Summary** card (rows, new, updated) with an **Errors** tab | External Evidence |
| HubSpot help text | History kept per import with the original file and an error file downloadable; imports older than six months cannot be repeated | External Evidence (text) |
| Zoho Books help text | **Import History** tab: user, module, file name, date, status, rows imported; filters by user and by module | External Evidence (text) |
| QuickBooks Online help text | A single «Import data» page with a record-type chooser, then a sample file; recommends an import order (accounts → customers/suppliers → products → invoices/bills) | External Evidence (text) |
| Daftra docs (the functional reference) | **No central hub**: imports live inside each module's list screen (products, invoices, customers…) | External Evidence (text) |
| Shopify help | CSV import documented per entity with a sample file and column description; docs only | External Evidence (text) |

## AWJ Decisions
- **A real hub, not per-module only.** Daftra has none; HubSpot, Zoho and QuickBooks do, and AWJ already has twelve wizards with no single door. Entry points on entity pages stay (H8-S3); this adds the door.
- **Entity table, not a card grid.** DESIGN_SYSTEM: dense tables are the hero. Rows grouped in four sections, with two columns — standard import and assistant import.
- **History as a filterable table** (entity, status), HubSpot/Zoho style, with continue links. Pagination 10/25/50.
- **Navigation map only.** No upload, no preview, no write from the hub; it reuses each wizard with its gates, so no new authorization surface.
- **Honest assistant column.** The plan calls for two equal entry points per entity. The assistant path exists for **products only** (the other AI slices wait on X-01/OPS-02), so the column shows a link there and «not available for this entity yet» elsewhere — no placeholder link. The master plan's dependency note («H8-S1 needs ≥2 entities with both paths») is therefore **not met**; this slice ships the standard path for all entities and the assistant path for one, and the column fills in as AI slices land. Disclosed deviation, easy to reverse.
- **Visibility = the sidebar's rule** (`isNavEntryVisible`): the manage permission of each entity's domain (mirror of `ImportJobDomain::AUTHORIZATION`) plus its application key; capability-state fetch failure hides nothing.
- **Resume links only where the wizard is knowable from the job:** customers/suppliers share one domain and categories/brands share one, and the list does not expose the type, so those rows say «continue it from its own import screen» instead of guessing a wizard. A stocktake-count run resumes at its frozen stocktake.
- **Sidebar:** «مركز الاستيراد» under Settings, no permission of its own (entities hide individually; a user who can import nothing sees an explained empty state).

## Rejected / Not Adopted
- A card grid with illustrations (low density, contradicts DESIGN_SYSTEM).
- A single universal upload box that auto-detects the entity (guessing an entity from a file is a correctness risk; AWJ wizards need entity-specific headers).
- Showing disabled AI buttons for entities without an AI path (implies a capability that does not exist).
- An «import order» wizard à la QuickBooks (out of scope; hints can come with H8-S3).

## Changed files
`web/src/modules/imports/{catalog.ts,ImportHub.tsx}`, `web/src/app/(app)/imports/page.tsx`, `web/src/components/layout/sidebar.tsx`, ar/en messages (`importHub` 69 keys, parity scripted; `nav.imports`).

## Tests
`catalog.test.ts` 6 + `ImportHub.test.tsx` 6 (12). The catalog test checks that **every linked route has a page file** (the hub can never lead to a 404). Mutation controls — each fails tests when applied: permission check removed · application-key check removed · resume offered for finished runs · page not reset on filter change · a guessed wizard for the shared partner domain · an invented assistant link for customers.

## Not done / follow-ups
- **AI action history is not in the list:** there is no list endpoint for `ai-actions` (only per-action reads), so the plan's «import-jobs + ai-actions» history is half delivered; needs a backend list endpoint (own slice, tenant/branch scoping to be designed).
- `import-jobs` list exposes `apply_result` without branch scoping (existing IMP-JOB-SCOPE-01); the hub shows only file name, entity, status, counts and error message.
- Component tests only; no screenshots of the new screen.
- H8-S2 (saved mapping presets, new table) and H8-S3 (entry points on entity pages) remain.
