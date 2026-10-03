# DLV-HUB-UI-1 — Implementation Report

STATUS: in review, not merged
DATE: 2026-10-03

## Outcome

Operational Delivery Hub workspace on the merged projection API, plus one presentation registry for platform name and mark. No invoice, payment, journal, VAT, revenue, COGS, stock movement, POS session, connector, or financial transition.

## Base

Rebased onto latest `origin/main` `513ced7e3c51480053a508e23be81759b45a9f8e`. That history contains the DLV-HUB-PROJECTION-1 squash `07c3820a9603061819b9a580b671d975a5ccf0aa`. This file does not embed its own commit hash.

## Platform registry

`web/src/lib/delivery-platform-registry.ts` is the only presentation map. HungerStation, Jahez, Mrsool, Keeta, Ninja, and The Chefz each have a canonical Arabic and English name. `logoSrc` is null for every key. `DeliveryPlatformMark` renders the name as text and, only when `logoSrc` is set, an unmodified image with an empty alt. Today the mark is a neutral letter, not a redrawn logo.

No official file was committed:

- Jahez brand guidelines (visual identity 1.1) require the master artwork and forbid recreation. Jahez terms prohibit republication of site content. The guidelines PDF is not a redistribution license for this repository.
- The HungerStation SVG on Wikimedia Commons is tagged as a trademark.
- The Keeta Network press kit is a different entity from the delivery platform and was not used.
- No permitted master was found for Mrsool, Ninja, or The Chefz.
- Brandfetch and image search are not licenses.

A generated or searched image was not used. POS selection uses the same mark and the same name helper. There is no delivery-platforms management screen in the web tree; wiring that screen is the next UI slice, not this one.

## Workspace

`/delivery-hub` lists orders and opens an operational detail. Tabs match the accepted states, including unrouted only when the context says the actor may see that queue. Filters are platform, branch, and state, all sent to the existing list endpoint, with page so a queue longer than 50 stays reachable. The API has no reference search, so the workspace does not invent one. Detail shows only projection fields. Timestamps go through the display formatter. `handed_off` is labeled as operational and not a posting. There is no payment, VAT, or stock control.

The page does not request hub data until the signed-in user has `delivery_hub.view`. Read-only view renders no actions. `delivery_hub.operate` shows the transitions the projection service accepts, including cancel from `handed_off` because that edge exists on the merged machine. Reroute is offered only while `received` and only among branches the context returned. The destination resets when the selected order changes. A slower list response cannot replace a newer filter. The backend remains the authority.

The list response includes platform key, catalog names, and branch name. `GET /api/delivery-hub/context` returns the actor's platforms, accessible branches, and whether the unrouted queue is visible. Those are read filters and labels, not a new business rule.

## Review resolutions

- Orders past the first page are reachable, and an out-of-range page clamps to the last page.
- In-flight list responses are ignored when a newer filter or page request has started. A transition refresh uses the latest query. Changing a filter or page clears the previous rows and selection, including when that request fails.
- The reroute destination clears in the same render as the selected order, and a destination outside the authorized list cannot be submitted.
- Direct navigation without `delivery_hub.view` shows a denial and does not call the hub API. A payload that is not a context object, including the demo fallback array, stays fail-closed and does not crash the workspace. An inactive branch stays visible for historical filtering and is rejected as a route destination by the server. A payload that is not a context object, including the demo fallback array, stays fail-closed and does not crash the workspace.

## Known limitations

Reopen after cancel is not implemented. Full DLV-HUB-1 stays blocked on DG-8-IMPORT and DG-3. The platforms management screen does not exist yet, so it was not restyled.

No production deploy.
