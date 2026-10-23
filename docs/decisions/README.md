# Decision records

Records follow `docs/autonomous-engineering/ADR-CONVENTION.md`. An accepted record is history: supersede it, do not silently rewrite it.

## TAX-ZATCA Horizon — D-05 (recorded 2026-10-15)

| ADR | Plan label | Subject | Status | Open gates |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-invoice-issue-timestamp.md) | ADR-A | Immutable `issued_at`; one issuance instant, several output representations | Accepted — **direction only**; **REM-13a implemented in a Draft PR** (not merged) | G-A1 (QR tag 3 = Q1) … G-A6; Q1/Q2 recorded for D-06 |
| [ADR-0002](ADR-0002-vat-categories-and-exemptions.md) | ADR-I | Explicit VAT categories S/Z/E/O, validated reason codes, no guessing of legacy 0% | Accepted — **direction only** | G-I1 … G-I7 |
| [ADR-0003](ADR-0003-monetary-rounding-and-tax-totals.md) | ADR-B | One verified monetary contract; **no calculation change approved** | Accepted — **direction only** | G-B1 … G-B8 |

**What "accepted — direction only" means.** The product owner approved the architectural direction. Each record separates (1) approved direction, (2) regulatory requirements verified by primary evidence (graded VL / CA / NV), (3) unresolved legal/tax interpretations (decision gates), and (4) decisions that still need explicit owner approval (schema changes, any change to tax totals or postings).

**D-05 is not resolved.** Tax-adviser sign-off has not been obtained, ZATCA clarification has not been sent (D-06/TAX-E01), and ADR-C, D, E (formal), F, G, H, J are not written. These records make no statement that AWJ complies with ZATCA Phase 1 or Phase 2.

**Implementation authorisation is per task.** ADR-0002 and ADR-0003 authorise no code. ADR-0001's slice REM-13a (the `invoices.issued_at` migration included) was authorised by the owner on 2026-10-15 and is implemented in a Draft PR — see `docs/audits/horizon/REM-13a-IMPLEMENTATION-REPORT.md`; it remains unmerged and undeployed until the owner decides.

Tracking: `docs/audits/horizon/TAX-ZATCA-RECONCILIATION-AUDIT.md` §7 · `TAX-HZ-00-REMEDIATION-BACKLOG.md` · `AWJ-TAX-ZATCA-HORIZON-TASK-QUEUE.md` · evidence: `docs/audits/horizon/TAX-HZ-00-EXTERNAL-EVIDENCE-REGISTER.md`.

## AWJ Payments Horizon — G0 (recorded 2026-10-22)

| ADR | Subject | Status | Open gates |
|---|---|---|---|
| [ADR-0004](ADR-0004-payments-orchestration-g0.md) | G0 decisions D-03…D-31; closed-period handling (D-12), retention (D-20), scheduler proof (D-25) | Accepted; **D-12 mechanism §3 proposed** | Owner approval of §3 before PAY-H2-02; G1–G6 |
| [ADR-0005](ADR-0005-moyasar-first-byog-provider.md) | G1: Moyasar أول مزوّد BYOG (Sandbox فقط) | Accepted (اختيار المزوّد والاختبارات فقط) | EXT-01 المفاتيح والتحقق |
| [ADR-0006](ADR-0006-payments-h2-02-owner-decisions-and-posting-matrix.md) | D-16، D-24، D-26، ADR-0004 §3 (R1) + مصفوفة قيود ترحيل الالتقاط | Accepted | R2/R3 والتفويض خارج النطاق |
| [ADR-0007](ADR-0007-payments-h3-01-gateway-refund-and-a5-matrix.md) | PAY-H3-01: استرداد البوابة، D-28 (موافقة مستقلة دائمة) + مصفوفة قيود A5 (R1–R12) | **Accepted — بوابة A5 مغلقة (2026-10-23)** | اعتماد المالك للمصفوفة والنموذج قبل أي كود محاسبي؛ EXT-01 لاسترداد Sandbox |
