# AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 — Decision Register

STATUS: **Owner review 2026-10-14: architecture ACCEPTED IN PRINCIPLE, with amendments to D-04 / D-08 / D-15. The amendments are applied below. G0 closes on the owner's explicit confirmation after this update.**
LAST_UPDATED: 2026-10-14
Evidence: `AWJ-VD-H1-0-EVIDENCE-AND-ARCHITECTURE.md` (sections referenced as §n) · `AWJ-VD-H1-VD3-EDITOR-UX-REQUIREMENTS.md`

> Even after G0 closes, implementing the DB/API changes requires the owner's explicit approval, as instructed. Merging every PR requires owner approval. Deploy/Production is outside this horizon.

## Status legend

- **ACCEPTED-IP**: accepted in principle by the owner.
- **ACCEPTED-IP + AMENDED**: accepted in principle, with an owner amendment applied.
- **PROPOSED**: new, or modified after review, and awaiting confirmation at G0 close.
- **OWNER-SET**: set by explicit owner instruction.

## Decisions

### D-01 — Where the visual identity lives
- **Decision:** a new, additive `commerce_facet_visuals` table. It is an optional 1:1 per facet or per value and holds normalized `visual` JSON (§3.2).
- **Alternatives rejected:**
  - Typed columns.
  - A column on the existing tables (mixes data with presentation).
  - Storing it inside the presentation document (ties it to one storefront).
- **Status:** ACCEPTED-IP

### D-02 — Media source
- **Decision:** reuse `storefront_media` through `MediaRef`.
- **Alternatives rejected:** `product_media`; category-style columns; a new store.
- **Status:** ACCEPTED-IP

### D-03 — Public serving of facet images
- **Decision:** a new guarded route, `store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}`.
  - 4 conditions are checked before any 304.
  - Only allow-listed files are served; the original never is.
  - Failures return one uniform 404 (§3.8-c).
- **Change after review:** `mediaId` is now part of the URL, so replacing the image changes the URL.
- **Status:** ACCEPTED-IP (the URL change is a technical refinement)

### D-04 — Authority to write the visual identity
- **Decision:**
  - **`commerce.manage` for this phase, with no change to existing RBAC** (`Rbac::MATRIX`, roles, permissions).
  - Facet data stays on `products.manage`.
  - **The UI blocks editing without the permission and states why.** The two visual-identity tabs are read-only, with a message naming the missing permission and who can grant it. Upload and select buttons are hidden. The preview keeps working.
  - Server tests:
    - accountant: 403 on the visual, 200 on the name;
    - `staff` and `self_service`: 403;
    - guest: 401.
  - Details: §3.8-a and VD-3 §3.8.
- **Status:** **ACCEPTED-IP + AMENDED**

### D-05 — Public API exposure
- **Decision:** `storefront.v1` only; `commerce/v1` is unchanged (test N16).
- **Status:** ACCEPTED-IP

### D-06 — Where per-surface display settings live
- **Decision:** optional fields inside the content of the existing `discovery` section.
- **Status:** ACCEPTED-IP

### D-07 — Display templates
- **Decision:** a code-owned, append-only registry of **7 templates**.
  - `catalog-rounded` was added, based on the owner's concept image for electronics and general retail.
  - Templates saved by merchants are DEFERRED.
- **Status:** ACCEPTED-IP (+1 template)

### D-08 — Inheritance
- **Decision:** **each property resolves independently**, along its own chain (table in §3.6).
  - **Customizing the image, or any other property, does not cancel inheritance of the shape, size, label, icon, or anything else.**
  - `content` resolves implicitly from the value's own media before falling back to the facet defaults.
  - The image itself is not inherited; the icon is.
  - Display-time fallback (image → icon → text) keeps the resolved shape and size.
  - Proven by a shared fixture with one test case per property.
- **Status:** **ACCEPTED-IP + AMENDED**

### D-09 — Framing
- **Decision:** `fit` + `focal` + `zoom`, applied with CSS over existing thumbnails. No `crop` or `rotate`.
- **Status:** ACCEPTED-IP

### D-10 — Icons
- **Decision:** an append-only extension of `IconRegistry`, plus `IconPicker`.
- **Status:** ACCEPTED-IP

### D-11 — Validation
- **Decision:** writes are strict (422); reads are tolerant and fail closed.
- **Status:** ACCEPTED-IP

### D-12 — Listing filter chips with images
- **Decision:** DEFERRED.
- **Status:** ACCEPTED-IP

### D-13 — Storefront dark mode
- **Decision:** out of scope. Dark and light mode are verified in the admin editor.
- **Status:** ACCEPTED-IP

### D-14 — Merge policy
- **Decision:** every PR requires explicit owner approval. No stacked PRs.
- **Status:** OWNER-SET

### D-15 — Caching and leakage
- **Decision:**
  - The origin sends `private, no-store` + ETag + `nosniff` on success, and `no-store` on every 404.
  - The Next proxy keeps **200 responses only**, for at most 300 s.
  - The gate runs before any 304, and `mediaId` is in the URL.
  - **Mandatory negative tests N1–N16** (§3.8-f), covering:
    - deactivating a value or facet;
    - deletion;
    - removing or replacing the image;
    - 304 after deactivation;
    - a foreign tenant;
    - an injected `mediaId`;
    - a media item that is not referenced;
    - the original file and path traversal;
    - the proxy not caching failures;
    - no original or library paths in `meta`;
    - `commerce/v1` unchanged.
  - Documented deactivation window: immediate at the origin, ≤ 300 s through the proxy for a URL already served.
- **Status:** **ACCEPTED-IP + AMENDED**

### D-16 — Serializing media deletion against visual saves *(new, from the Codex P2 review on #1472)*
- **Decision:**
  - Both paths take a `lockForUpdate` on the `storefront_media` row(s) inside a transaction:
    - `StorefrontMediaService::delete()` re-scans after the lock;
    - saving a visual re-checks the media state after the lock, locking rows in id order.
  - Deterministic tests plus a two-connection pgsql test (§3.8-d).
  - The same pre-existing race in presentation documents is recorded as backlog, outside scope.
- **Alternatives:**
  - A foreign key from the visual to the media: there is no column, the reference is JSON, and media is soft-deleted, so an FK would not prevent it.
  - A periodic cleanup job: it leaves a window where a reference to deleted media stays visible.
- **Status:** **PROPOSED** (needs G0 confirmation, because it modifies `StorefrontMediaService::delete()`)

## Open questions (do not block G0)

1. The 7 template names and their meanings (§3.7).
2. The proposed icon list (§3.5).
3. ~~Current-UI screenshots~~: **resolved**. They arrived (`IMG_2584`–`IMG_2588`) and are analysed in `AWJ-VD-H1-VD3-EDITOR-UX-REQUIREMENTS.md`.
