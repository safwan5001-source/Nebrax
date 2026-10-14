# AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 — Decision Register

STATUS: **APPROVED — the owner explicitly approved D-01..D-17 and closed G0 on 2026-10-14.** Implementing the DB/API changes (VD-1b, VD-1c) still requires a separate explicit approval, and every merge still requires the owner's approval.
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
- **Status:** APPROVED (G0, 2026-10-14)

### D-02 — Media source
- **Decision:** reuse `storefront_media` through `MediaRef`.
- **Alternatives rejected:** `product_media`; category-style columns; a new store.
- **Status:** APPROVED (G0, 2026-10-14)

### D-03 — Public serving of facet images
- **Decision:** a new guarded route, `store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}`.
  - 4 conditions are checked before any 304.
  - Only allow-listed files are served; the original never is.
  - Failures return one uniform 404 (§3.8-c).
- **Change after review:** `mediaId` is now part of the URL, so replacing the image changes the URL.
- **Channel scope (Codex P2, #1472):** the second condition is extended: the value must be visible on the resolved storefront's sales channel. It needs at least one active product published there through `CommerceListing`, which is the same predicate as the product list. For a facet image, any active value must be visible. This stops a URL obtained on storefront A from being replayed against storefront B (tests N17–N19).
- **Change after Codex P1 (#1472):** the API emits the origin path, matching every other media family. The storefront adds an explicit, validated branch to `toRenderableMediaUrl()`, placed before the generic pattern, that maps it to `/api/storefront/media/facet-visuals/...`. Anything else maps to `null`, which triggers the fallback chain. A raw origin path never reaches `<img>`. This is covered by mapper tests and by real browser loading in VD-5.
- **Status:** APPROVED (G0, 2026-10-14)

### D-04 — Authority to write the visual identity
- **Decision:**
  - **`commerce.manage` for this phase, with no change to existing RBAC** (`Rbac::MATRIX`, roles, permissions).
  - Facet data stays on `products.manage`.
  - **The UI blocks editing without the permission and states why.** The two visual-identity tabs are read-only, with a message naming the missing permission and who can grant it. Upload and select buttons are hidden. The preview keeps working.
  - Server tests:
    - accountant: 403 on the visual, 200 on the name;
    - `staff` and `self_service`: 403;
    - guest: 401.
  - **Preview for read-only users:** `GET facets` (`products.view`) carries short-lived `visual_preview` signed URLs, on the existing variant route, only for referenced media. This adds no library access and changes no RBAC (Codex P2, #1472).
  - Details: §3.8-a and VD-3 §3.8.
- **Status:** **APPROVED with owner amendments** (G0, 2026-10-14)

### D-05 — Public API exposure
- **Decision:** `storefront.v1` only; `commerce/v1` is unchanged (test N16).
- **Status:** APPROVED (G0, 2026-10-14)

### D-06 — Where per-surface display settings live
- **Decision:** optional fields inside the content of the existing `discovery` section.
- **Status:** APPROVED (G0, 2026-10-14)

### D-07 — Display templates
- **Decision:** a code-owned, append-only registry of **7 templates**.
  - `catalog-rounded` was added, based on the owner's concept image for electronics and general retail.
  - Templates saved by merchants are DEFERRED.
- **Status:** APPROVED (G0, 2026-10-14)

### D-08 — Inheritance
- **Key name:** the key is `showLabel`, singular, in every layer: value, facet, section, resolver, and fixtures (Codex P2, #1472).
- **Decision:** **each property resolves independently**, along its own chain (table in §3.6).
  - **Customizing the image, or any other property, does not cancel inheritance of the shape, size, label, icon, or anything else.**
  - `content` resolves implicitly from the value's own media before falling back to the facet defaults.
  - The image itself is not inherited; the icon is.
  - Display-time fallback (image → icon → text) keeps the resolved shape and size.
  - Proven by a shared fixture with one test case per property.
- **Status:** **APPROVED with owner amendments** (G0, 2026-10-14)

### D-09 — Framing
- **Decision:** `fit` + `focal` + `zoom`, applied with CSS over existing thumbnails. No `crop` or `rotate`.
- **Status:** APPROVED (G0, 2026-10-14)

### D-10 — Icons
- **Decision:** an append-only extension of `IconRegistry`, plus `IconPicker`.
- **Status:** APPROVED (G0, 2026-10-14)

### D-11 — Validation
- **Decision:** writes are strict (422); reads are tolerant and fail closed.
- **Status:** APPROVED (G0, 2026-10-14)

### D-12 — Listing filter chips with images
- **Decision:** DEFERRED.
- **Status:** APPROVED (G0, 2026-10-14)

### D-13 — Storefront dark mode
- **Decision:** out of scope. Dark and light mode are verified in the admin editor.
- **Status:** APPROVED (G0, 2026-10-14)

### D-14 — Merge policy
- **Decision:** every PR requires explicit owner approval. No stacked PRs.
- **Status:** OWNER-SET

### D-15 — Caching and leakage
- **Decision:**
  - The origin sends `private, no-store` + ETag + `nosniff` on success, and `no-store` on every 404.
  - The Next proxy keeps **200 responses only**, for at most 300 s.
  - The gate runs before any 304, and `mediaId` is in the URL.
  - **Mandatory negative tests N1–N19** (§3.8-f), covering:
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
- **Status:** **APPROVED with owner amendments** (G0, 2026-10-14)

### D-17 — Mandatory concurrency token *(new, from Codex P2 on #1472)*
- **Decision:**
  - An integer `version` column on `commerce_facet_visuals`, incremented on every write.
  - `expected_version` is **required whenever a row exists**:
    - a missing value returns `428`;
    - a mismatch returns `409` with `current_version`;
    - `null` is allowed only to create a row that does not exist yet.
  - Two creates at the same time: the unique index turns the second into `409`.
  - **No ABA (Codex P1, #1472):** the API never deletes a visual row. "Remove" empties it to `{}` and increments `version`. Rows disappear only by cascade when the facet or value itself is deleted, and a recreated owner gets a new UUID. So a version number never repeats for the same owner.
  - Full table in §3.8-a.
- **Alternatives:**
  - An optional `if_unmodified_since`: it allows silent overwrites.
  - The `updated_at` timestamp: one-second precision cannot detect two writes within the same second.
- **Status:** **APPROVED** (G0, 2026-10-14). Implementation in VD-1b needs the separate DB/API approval.

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
- **Status:** **APPROVED** (G0, 2026-10-14)

## Open questions (do not block G0)

1. The 7 template names and their meanings (§3.7).
2. The proposed icon list (§3.5).
3. ~~Current-UI screenshots~~: **resolved**. They arrived (`IMG_2584`–`IMG_2588`) and are analysed in `AWJ-VD-H1-VD3-EDITOR-UX-REQUIREMENTS.md`.
