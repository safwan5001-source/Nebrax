# Decision records

Records follow `docs/autonomous-engineering/ADR-CONVENTION.md`. An accepted record is history: supersede it, do not silently rewrite it.

## TAX-ZATCA Horizon — D-05 (recorded 2026-10-15)

| ADR | Plan label | Subject | Status | Open gates |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-invoice-issue-timestamp.md) | ADR-A | Immutable `issued_at`; one issuance instant, several output representations | Accepted — **direction only** | G-A1 … G-A6 |
| [ADR-0002](ADR-0002-vat-categories-and-exemptions.md) | ADR-I | Explicit VAT categories S/Z/E/O, validated reason codes, no guessing of legacy 0% | Accepted — **direction only** | G-I1 … G-I7 |
| [ADR-0003](ADR-0003-monetary-rounding-and-tax-totals.md) | ADR-B | One verified monetary contract; **no calculation change approved** | Accepted — **direction only** | G-B1 … G-B8 |

**What "accepted — direction only" means.** The product owner approved the architectural direction. Each record separates (1) approved direction, (2) regulatory requirements verified by primary evidence (graded VL / CA / NV), (3) unresolved legal/tax interpretations (decision gates), and (4) decisions that still need explicit owner approval (schema changes, any change to tax totals or postings).

**D-05 is not resolved.** Tax-adviser sign-off has not been obtained, ZATCA clarification has not been sent (D-06/TAX-E01), and ADR-C, D, E (formal), F, G, H, J are not written. These records make no statement that AWJ complies with ZATCA Phase 1 or Phase 2.

**Nothing here authorises implementation.** In particular, the database migration adding `invoices.issued_at` is **NOT YET AUTHORIZED**; the proposed next slice REM-13a is described in ADR-0001 and is not started.

Tracking: `docs/audits/horizon/TAX-ZATCA-RECONCILIATION-AUDIT.md` §7 · `TAX-HZ-00-REMEDIATION-BACKLOG.md` · `AWJ-TAX-ZATCA-HORIZON-TASK-QUEUE.md` · evidence: `docs/audits/horizon/TAX-HZ-00-EXTERNAL-EVIDENCE-REGISTER.md`.
