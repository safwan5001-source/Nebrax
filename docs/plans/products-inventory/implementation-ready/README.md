# Products & Inventory — Implementation-Ready Preparation

**Status:** PREPARING — no code implementation authorized.
**Baseline:** `main` after PR #662 (`f73a3f2bb5685e8f9e995e0febe61f81459c2a88`).
**Executor when authorized later:** Claude Code only.

This layer converts approved architecture contracts into exact implementation packets grounded in current code. It does not execute the PRs.

## Packet requirements
Each packet records: current-code anchors, exact FROM→TO boundary, files expected to change vs inspect-only, schema/API impact, security/accounting/UOM/concurrency proof obligations, test locations/cases, stop conditions, dependencies, and final Claude Code handoff readiness.

## Rule
If current code contradicts the planning contract, update the preparation packet or raise a decision; do not silently rewrite the approved architecture and do not start implementation.