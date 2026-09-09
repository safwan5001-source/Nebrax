# CUS-FOUNDATION-1 — Approved V1 Implementation Decisions

**Status:** APPROVED — implementation input for `CUS-FOUNDATION-1 — Customer Digital Access Foundation`

**Date:** 2026-09-09

**Parent architecture:** `docs/plans/customers/CUS-ARCH-0-CUSTOMER-PLATFORM-ARCHITECTURE.md`

## Purpose

This document closes the minimum product/implementation choices needed to begin CUS-FOUNDATION-1. It does not replace CUS-ARCH-0. All CUS-ARCH-0 architecture, tenant, ownership, Partner, principal-separation and security decisions remain authoritative unless explicitly narrowed here.

## Approved V1 decisions

### 1. Login identifier

V1 customer login is **email + password**.

Phone/mobile remains customer identity/contact data that may be normalized and designed for future use, but it is not an enabled V1 login method unless a later approved change adds the required verification/recovery controls.

### 2. Email verification and production activation

Customer email verification is the V1 verification direction.

If AWJ does not have a real, production-capable email delivery channel at implementation time, CUS-FOUNDATION-1 may build the secure verification primitives/contracts and tests, but **must not fake verification and must not enable public production registration as verified**.

No hard-coded OTP, magic bypass, auto-verification, log-only proof, or development shortcut may be treated as production verification.

### 3. Customer sessions/tokens

Customer authentication reuses Sanctum token storage while keeping customer principal semantics strictly separate from staff `User` semantics.

V1 customer access token expiry: **7 days**, matching the current AWJ staff-token duration as an operational starting point, not as shared authorization semantics.

Required behavior includes current-session logout/revocation and explicit customer-token abilities/principal checks.

### 4. Password recovery

CUS-FOUNDATION-1 must define the secure recovery boundary and leave the architecture ready for password recovery, but **must not enable a production recovery flow without a real proof-delivery channel**.

Recovery must never rely on identity matching alone or on an unverified email/mobile value.

### 5. Checkout policy

AWJ Commerce V1 will support both:

- **Guest checkout**; and
- **Authenticated customer account checkout**.

A Customer Digital Identity is not mandatory merely to browse, create a guest cart, or proceed through the future guest checkout path.

### 6. Partner creation and linking

Customer registration creates a **CustomerIdentity only**.

Registration must not automatically create a `Partner`, and must not silently link to an existing Partner based on name, email, phone/mobile, or other string matching.

Partner linking requires an explicit, auditable, proof-backed flow under the CUS-ARCH-0 rules. Partner remains the AWJ commercial/accounting Customer Master.

### 7. Invitations / claims

Invitation or claim flows may only be enabled when the implementation has a real secure proof-delivery mechanism and replay-safe verification.

If that capability is unavailable, the data/service boundary may be prepared where justified, but the production flow remains disabled. No insecure placeholder invitation flow is acceptable.

### 8. Contacts and addresses

No new shared customer Contact/Address subsystem is part of CUS-FOUNDATION-1.

The CUS-ARCH-0 conclusion remains locked:

`CUS-CONTACT-1-MIN = NOT REQUIRED BEFORE COMMERCE RESUMES`.

Partner's existing current/default contact/address data remains commercial master data. Immutable checkout/order contact, shipping and billing snapshots remain a later Commerce responsibility. Saved/multiple customer addresses are a later Customer Platform capability.

### 9. Staff/customer principal separation — mandatory first security gate

Before any CustomerIdentity token can be issued, CUS-FOUNDATION-1 must close the CUS-ARCH-0 principal-confusion blocker:

- apply `EnsureUserPrincipal` to the complete internal staff route group;
- place it before tenant establishment (`SetTenant`) for staff requests;
- add regression tests proving CustomerIdentity/customer tokens cannot enter staff routes and staff tokens cannot enter customer-only routes.

Customer token issuance must not ship ahead of this gate.

### 10. Tenant resolution remains unchanged

CUS-ARCH-0 tenant resolution remains authoritative:

- resolve active tenant from globally unique route `Tenant.slug` before credential lookup;
- establish `TenantContext` fail-closed;
- scope CustomerIdentity lookup to that tenant;
- allow the same normalized email to exist in different tenants;
- never use email/mobile, request-supplied tenant_id, or SalesChannel slug alone as tenant authority.

## CUS-FOUNDATION-1 implementation boundary

CUS-FOUNDATION-1 is one implementation task with internal checkpoints:

1. staff/customer principal separation hardening;
2. tenant-safe CustomerIdentity persistence;
3. customer authentication/session foundation;
4. explicit CustomerIdentity ↔ Partner link foundation;
5. `CustomerContext` and ownership boundary;
6. verification/invitation/recovery primitives only to the extent they can be implemented securely under the real delivery capabilities available;
7. SQLite + PostgreSQL + security/concurrency/tenant-isolation regression coverage.

## Explicit non-goals

CUS-FOUNDATION-1 does **not** implement Customer Portal UI, customer invoice/payment/statement UI, saved/multiple addresses, CommerceOrder integration, full checkout, memberships, subscriptions, loyalty, attendance, B2B roles, accounting behavior, ZATCA behavior, POS changes, or deployment.

## Stop / Requires Verification rule

Implementation must stop and report `REQUIRES VERIFICATION` rather than invent behavior if repository evidence contradicts CUS-ARCH-0, if a real verification/recovery delivery channel cannot be established for a flow that requires proof, or if a change would alter accounting, Commerce order semantics, staff RBAC semantics beyond the approved principal guard, or tenant authority.

## Approval

These V1 choices are approved as the implementation input for CUS-FOUNDATION-1. Any material deviation requires an explicit architecture/product decision before implementation.