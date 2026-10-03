# DLV-PLATFORM-MGMT-UI-1 — Implementation Report

STATUS: in review, not merged
DATE: 2026-10-03

## Outcome

Delivery Platforms management workspace. It reads and writes the existing foundation API and renders names and marks only from `web/src/lib/delivery-platform-registry.ts`. No accounting, inventory, connector, webhook, or POS redesign.

## Approach

One sales-nav page, gated by `invoices.view` and the `sales.pos` application. Saves require `company.manage`. The six catalog platforms are listed even when unconfigured. Status is unconfigured, enabled, or disabled. Collection mode, reference policy, display names, the current version, and branch overrides are the only settings. `delivery_hub.view` and `delivery_hub.operate` are not used. No logo file is committed.

## Known gaps

There is no version-history browser; the current version number is shown. `logo_asset_key` is not edited, so an unlicensed path cannot be presented as a logo. Official logos remain unavailable. No connector status exists to display.

No production deploy.
