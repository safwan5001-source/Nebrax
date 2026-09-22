# ADR-12 — Commerce API Locale Resolution

**Status:** Accepted — Owner Decision
**Date:** 2026-09-22
**Scope:** authorizes a shared `Accept-Language`-based locale resolver/middleware for the public Commerce API surface (`/commerce/v1`, `/store/v1`, future App Builder consumers). Does not mandate converting every existing hardcoded error message in one pass.

## Context

Repository evidence (Decision/Evidence Packet, delivered 2026-09-22) confirmed:

- Bilingual data fields (`name`/`name_en` and equivalents) already exist pervasively across business models — the data layer is already bilingual.
- No server-side locale resolution exists anywhere in `/commerce/v1` or `/store/v1` — no `Accept-Language` handling, no locale middleware. Clients receive both `name` and `name_en` raw and choose themselves.
- Error messages throughout `/commerce/v1` are hardcoded Arabic strings with no English fallback.
- `COMMERCE_MOBILE_API_READINESS.md` already classified this "Ready with Hardening" — the mechanism is the gap, not the underlying data.
- The staff-facing web dashboard's `next-intl` i18n system is a separate concern (browser UI for a human), not a reusable mechanism for API-response locale.

`Accept-Language` (RFC 9110 §12.5.4) is the standard HTTP mechanism for this exact problem; no vendor or provider decision is involved.

## AWJ Decision (owner-authorized)

1. **A shared locale resolver/middleware**, reading the standard `Accept-Language` header, is introduced at the same layer as existing shared Commerce middleware (e.g., alongside `ResolveCommerceChannel`), setting the resolved locale for the duration of the request.
2. **Supported locales for this pass: `ar`, `en`.**
3. **Default when no supported preference is present: `ar`** — Arabic is AWJ's default Commerce API locale, matching the project's Arabic-first identity.
4. **Shared across every Commerce-facing surface** — `/commerce/v1`, `/store/v1`, and future App Builder consumers use the same resolver; no channel-specific locale logic.
5. **Backward compatible.** Existing resources that expose both `name` and `name_en` continue to do so unchanged — the resolver adds a locale *authority* to the request (available for new/updated resources to consume, e.g., a single locale-aware `name`/`display_name` field where a resource chooses to add one), it does not remove either existing field from any current response.
6. **Error-message localization may proceed incrementally.** Converting every existing hardcoded Arabic string to route through a translation catalog in one pass is not required if it would materially expand this task's scope — but any *new* error message introduced from this point forward must route through the shared locale authority this ADR establishes, not add another hardcoded or channel-specific string.

## Open Decisions (still not made — explicitly out of scope here)

- The exact mechanism/timeline for migrating the full existing hardcoded-error-string catalog to translated strings — an incremental follow-up, not blocked on this ADR.
- Whether additional locales beyond `ar`/`en` are ever needed.

## Consequences

### Benefits
Closes the one readiness-doc gap that needed no vendor decision at all; establishes the correct shared seam so no channel (mobile, web, App Builder) diverges on locale behavior.

### Costs / trade-offs
Error-message translation remains incomplete after this pass by design — a deliberately bounded first step, not the full localization of every existing string.

## References
- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md`
- RFC 9110 §12.5.4 (`Accept-Language`)
- `docs/plans/commerce/COM-MOBILE-I18N-1-IMPLEMENTATION-REPORT.md` (full evidence, once implemented)
