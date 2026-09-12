# COM-WS-1 — Commerce Workspace Shell

**Status:** implemented on a feature branch, not merged
**Date:** 2026-09-12
**Base:** latest `main`

## Decision applied

Commerce Workspace is an AWJ ERP command center. It does not copy products,
customers, inventory, invoices, payments, reports, or RBAC.

Public storefront remains `/storefront`. This workspace lives in `/web`.

## UX

- Main AWJ nav: one group/entry **التجارة الإلكترونية** / **E-commerce** → `/commerce`
- Dedicated workspace shell (Fuel Stations pattern): own header + internal sidebar
- Destinations: overview, stores, published products, appearance/content, domains, delivery/channel settings, integrations
- Header: current-store selector foundation + **عرض المتجر** / **View store**

## API reuse / gap

Inspected `routes/api.php` and storefront public routes.

- No tenant-scoped ERP admin API lists `SalesChannel`, `Storefront`, or `StorefrontDomain`
- Public `GET store/v1/storefront` is Host-resolved and must not be called with a client-chosen tenant

Selector and View Store stay explicitly unavailable until that admin contract exists.
