# AWJ — Configurable Policy Principle

**Status:** Project-wide architecture/product principle  
**Applies to:** All AWJ modules and future work  
**Date:** 2026-09-14

## Purpose

AWJ serves businesses whose valid operating policies can differ by industry, tenant and workflow. The system should not force one arbitrary workflow when multiple business behaviors are genuinely correct. At the same time, Settings must never become a way to weaken system integrity or postpone a correctness decision.

## Core rule

> **One objectively correct and safe behavior → enforce it as a system invariant.**  
> **Multiple genuinely correct business behaviors → prefer a tenant-configurable policy when configuration is safe and useful.**

This is a project-wide AWJ rule, not a Product/Variants-specific rule.

## When to use Settings

A policy may become configurable when ALL of the following are true:

1. two or more behaviors are legitimate for real businesses or industries;
2. every supported behavior preserves accounting correctness, inventory integrity, Tenant Isolation, security and applicable regulatory requirements;
3. changing the policy cannot corrupt historical transactions or silently reinterpret posted documents;
4. AWJ can provide a clear and safe default suitable for most tenants;
5. the choice has stable business meaning and is understandable to administrators;
6. the choice can be implemented and tested consistently across all affected surfaces.

## What must NOT become configurable

Settings must not weaken or bypass invariants, including but not limited to:

- Tenant Isolation and tenant ownership validation;
- ledger balance and accounting integrity;
- immutable/historical truth of posted financial documents;
- inventory quantity and valuation integrity;
- authorization/security boundaries;
- required fiscal/period locks;
- ZATCA/regulatory lifecycle restrictions;
- idempotency/concurrency guarantees where required for correctness;
- database/domain constraints required to prevent invalid state.

If one alternative violates an invariant, it is not a tenant preference and must not be exposed as a setting.

## Historical behavior

When a configurable policy affects calculation, pricing, posting, inventory treatment or another transaction result, AWJ must preserve enough transaction-time data/snapshots so a later Settings change does not recalculate or reinterpret already-posted history.

A policy change should normally affect future operations only unless a separately designed, explicit and audited migration/recalculation workflow exists.

## Required contract for every configurable policy

Before implementation, document:

- policy name and business purpose;
- scope (normally tenant; narrower scopes only when justified);
- safe default;
- allowed values and exact semantics;
- permission required to change it;
- effective-time behavior;
- historical-document behavior;
- accounting/inventory implications where applicable;
- API, POS, Commerce, reporting and integration consistency where affected;
- audit-log requirement where operationally or financially material;
- Tenant Isolation and regression tests for every supported mode.

## Decision procedure for agents and implementers

When implementation encounters a policy choice:

1. Determine whether one option is required for correctness/security/regulation. If yes, enforce it and do not create a Setting.
2. If multiple options are genuinely valid, evaluate them under this principle.
3. If configuration is appropriate, propose the policy, safe default and affected surfaces instead of silently choosing one tenant behavior forever.
4. If the decision materially affects accounting, inventory, security, APIs or database semantics and is not already approved, stop and surface the decision before implementation.
5. Never add a Setting merely to hide unresolved architecture or engineering uncertainty.

## Examples

Potentially configurable when both modes are safe: presentation/workflow preferences, optional operational policies, valid industry-specific behavior, or media/commerce/POS behavior where multiple legitimate modes exist.

Not configurable merely by preference: cross-tenant access, unbalanced journal posting, invalid stock/valuation state, bypassing required locks, weakening regulatory controls, or changing the historical meaning of posted documents.

## Relationship to module-specific decisions

Module documents may define stricter rules and concrete policies, but they inherit this project-wide principle. A module-specific decision register should reference this principle rather than restating or weakening it.

Where a module has multiple valid policies, the existence of this principle does **not** automatically authorize a new Setting; the concrete setting and its default still require design within that module's scope.
