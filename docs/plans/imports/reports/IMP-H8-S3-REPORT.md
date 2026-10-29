# IMP-H8-S3 — Entry points on entity pages (audit + guard)

**Web test + docs only.** No product code, backend, migration, permission, env or ZATCA change; no journal entries.

## Audit
The plan asks for import entry points on the entity pages (products, customers, suppliers, purchases, expenses, inventory openings, stocktakes), with the standard path never hidden behind AI. Each wizard slice had already added its own entry; nothing was missing:

| Entity | Entry on its own page |
|---|---|
| Products | `/products` — standard (`/products/import`), workbook, and assistant side by side |
| Categories · Brands · Unit templates | each settings page links to its `…/import` |
| Price list items | pricelists screen «import from file» (preselects the open list) |
| Inventory openings · Stock permits | list-page actions |
| Stocktake counts | the stocktake page («import counts») — import belongs to one stocktake |
| Customers · Suppliers · Purchases · Expenses | list-page actions (partners gated by `partners.manage`) |

So the slice is satisfied by the earlier slices; what was missing is a guard.

## What this adds
`web/src/modules/imports/entry-points.test.ts` (15 tests): every hub entity must link to its standard import from its own page (source-text check, since the links are built in JSX); products keeps standard + workbook + assistant together; **no other page invents an assistant entry**. Mutation control: renaming the brands link target fails the brands test.

## Not done
Hub-from-entity-page links (a «see all imports» shortcut on each list) were considered and not added: the sidebar already carries the hub, and a second link per page is clutter without a user need on record.
