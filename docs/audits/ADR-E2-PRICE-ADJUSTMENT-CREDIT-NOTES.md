# ADR-E2 — Credit notes that adjust price without returning quantity

| | |
|---|---|
| **Status** | **PROPOSED — decision pending.** No financial rule is changed by this document or by REM-02. |
| **Relates to** | ADR-E (credit/debit-note model) in `AWJ-TAX-ZATCA-REMEDIATION-PLAN.md` §5; REM-02 (VAT-02, ACC-06); REM-18 (e-invoicing of notes) |
| **Decision owner** | Product owner + Finance |
| **Deciders needed before implementation** | Finance (accounting treatment), Compliance (REM-18 reason codes) |

## 1. Context — what REM-02 does today

A sales credit note linked to a posted invoice binds every line to a source invoice line and is capped **cumulatively with returns on three quantities**: quantity, net base and VAT. A line may be credited at a *lower unit price* (partial credit); the net and VAT scale proportionally.

Consequence (deliberate, mirrors REM-01 for returns): **a reduced-price note consumes quantity.** Crediting 20 % of one unit uses that unit's quantity, so a second 20 % rebate on the same 1-unit line is refused even though 60 % of the value is still creditable. Also, the amount held back by a reduced-price credit is *not* returned with the last unit (the hold-back rule).

This is the correct, conservative behaviour for **returns and refunds**. It is awkward for a different business event: a **price adjustment** (volume rebate, goodwill allowance, billing correction) where no goods come back and the customer may legitimately be credited several times against one line up to the invoiced value.

## 2. The decision to make

How should a *price-adjustment* credit note (no quantity returned) be modelled?

| Option | Behaviour | Pros | Cons |
|---|---|---|---|
| **A. Keep as is** (default today) | Price adjustment = reduced-price quantity credit; consumes quantity. | No change; simplest; cap logic uniform. | Repeated adjustments blocked; users must credit once per unit; awkward for rebates. |
| **B. Value-only adjustment kind** | New line kind `price_adjustment` on a note: consumes **net/VAT value only**, never quantity. Cap: Σ adjustments + Σ returns/credits (value) ≤ charged value; quantity cap unchanged for quantity-bearing lines. | Matches the business event; repeated rebates work; ledger entry identical (Dr 4110/2120, Cr 1130/1110). | New line kind + UI + migration (`kind`); rules for how a later *return* treats prior adjustments (hold-back vs refund) must be decided; REM-18 reason code mapping. |
| **C. Separate document type** | "Price adjustment note" as its own document (own numbering/prints). | Clean semantics, clean reporting. | Largest change; new numbering, templates, permissions; duplicates the credit-note engine. |

## 3. Questions Finance must answer first (these change money)

1. After a value-only adjustment, does a later **return** of the units refund the *invoiced* value (adjustment then becomes a separate credit) or only the *remaining* value (adjustment is netted)? REM-01's reduced-price rule says "hold back"; that is a policy, not a technical fact.
2. Is a price adjustment **VAT-neutral to the date of the original supply** or taxed at the note date? (KSA treatment of post-supply price reductions — needs a tax adviser/ZATCA reference; per CLAUDE.md commerce rule 9 it must not be guessed.)
3. Must an adjustment always reference one invoice line, or may it be header-level (no line)?
4. Reason codes required for REM-18 (BR-KSA-17) — is "price adjustment" a distinct reason?

## 4. Recommendation (not a decision)

Prefer **Option B** (value-only kind on the existing credit-note), *after* questions 1–2 are answered, because it keeps one document type and one ledger path. Until then, **Option A stays**: it can never over-credit; its only cost is operational inconvenience.

## 5. What implementation would require (so the decision can be sized)

- Migration: `credit_note_lines.kind` (`quantity` default | `price_adjustment`), additive, default preserves every existing row.
- `ReturnSourceAllocator::returned()` returns value consumed separately from quantity consumed; `allocate()` gains a value-only path; the hold-back rule gets an explicit, settings-driven policy (CLAUDE.md rule 6: policy is configured, not imposed).
- Tests: value cap shared with returns, repeated adjustments, rounding to the halala, concurrency on PostgreSQL, tenant/branch isolation, backward compatibility of existing notes.
- UI: a per-line "adjust price only" mode on the invoice-linked credit-note screen.

## 6. Out of scope here

No code, no setting, no migration. REM-02 behaviour (Option A) is unchanged until this ADR is accepted.
