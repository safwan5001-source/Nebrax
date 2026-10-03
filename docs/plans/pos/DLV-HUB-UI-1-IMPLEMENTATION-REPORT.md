# DLV-HUB-UI-1 — Implementation Report

STATUS: in review, not merged
DATE: 2026-10-03

## Outcome

Operational Delivery Hub workspace on the merged projection API, plus one presentation registry for platform name and mark. No invoice, payment, journal, VAT, revenue, COGS, stock movement, POS session, connector, or financial transition.

## Base

Branch cut from `origin/main` `8663d489b618c03d31439dc6ce885b6e5fb267e0`, which contains the DLV-HUB-PROJECTION-1 squash `07c3820a9603061819b9a580b671d975a5ccf0aa`. This file does not embed its own commit hash.

## Platform registry

`web/src/lib/delivery-platform-registry.ts` is the only presentation map. HungerStation, Jahez, Mrsool, Keeta, Ninja, and The Chefz each have a canonical Arabic and English name. `logoSrc` is null for every key. The mark is a single neutral letter, not a redrawn logo. `DeliveryPlatformMark` always renders the name as text.

No official file was committed:

- Jahez brand guidelines require the master artwork and do not grant redistribution into this repository.
- The HungerStation SVG on Wikimedia Commons is tagged as a trademark.
- The Keeta Network press kit is a different entity from the delivery platform and was not used.
- No permitted master was found for Mrsool, Ninja, or The Chefz.

A generated or searched image was not used. POS selection now uses the same mark component. There is no delivery-platforms management screen in the web tree; wiring that screen is the next UI slice, not this one.

## Workspace

`/delivery-hub` lists orders and opens an operational detail. Tabs match the accepted states, including unrouted only when the context says the actor may see that queue. Filters are platform, branch, and state, all sent to the existing list endpoint. The API has no reference search, so the workspace does not invent one. Detail shows only projection fields. `handed_off` is labeled as operational and not a posting. There is no payment, VAT, or stock control.

Read-only `delivery_hub.view` renders no actions. `delivery_hub.operate` shows the accepted transitions. Reroute is offered only while `received` and only among branches the context returned. The backend remains the authority.

The list response now includes platform key, catalog names, and branch name. `GET /api/delivery-hub/context` returns the actor's platforms, accessible branches, and whether the unrouted queue is visible. Those are read filters and labels, not a new business rule.

## Known limitations

The workspace is entered with `delivery_hub.view`. Actions also require `delivery_hub.operate`. Reopen after cancel is not implemented. Full DLV-HUB-1 stays blocked on DG-8-IMPORT and DG-3.

No production deploy.
