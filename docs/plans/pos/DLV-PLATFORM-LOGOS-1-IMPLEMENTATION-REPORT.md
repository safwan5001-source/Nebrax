# DLV-PLATFORM-LOGOS-1 — Implementation Report

STATUS: in review, not merged
DATE: 2026-10-03
BASE: `bcc1563ed4659c1145c998b5097301ffa100fd09` (PR #1203)

## Outcome

The six canonical delivery platforms now render the publisher's current official icon plus the platform name. `web/src/lib/delivery-platform-registry.ts` is the only logo map. Delivery Platforms, Delivery Hub, and the POS selector all use `DeliveryPlatformMark`.

## Assets

Each file is the 512×512 App Store icon published by the brand owner on 2026-10-03. The JPEG bytes were stored as PNG with no resize, crop, recolor, or redraw. A monogram remains only for an unknown platform or a failed file. No CSS filter is applied.

| Platform | File | Publisher |
|---|---|---|
| HungerStation | `web/public/delivery-platforms/hungerstation.png` | HungerStation LLC |
| Jahez | `web/public/delivery-platforms/jahez.png` | Jahez International Information Systems Technology Company Limited Liability |
| Mrsool | `web/public/delivery-platforms/mrsool.png` | MRSOOL |
| Keeta | `web/public/delivery-platforms/keeta.png` | Kangaroo Limited |
| Ninja | `web/public/delivery-platforms/ninja.png` | TECH-ADVANCE FOR INFORMATION TECHNOLOGY CO |
| The Chefz | `web/public/delivery-platforms/the-chefz.png` | The Chefz |

Keeta is the food-delivery app (`com.sankuai.sailor.ifooddelivery`), not the unrelated Keeta Network brand.

## Out of scope

No accounting, VAT, inventory, settlement, commission, reconciliation, financial transition, connector, webhook, or permission change. `logo_asset_key` is still not an image path. Full DLV-HUB-1 stays blocked on DG-8-IMPORT and DG-3.

No production deploy.
