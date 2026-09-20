# AWJ Store — Business Documents Viewer V1

**Status:** Product / UX baseline  
**Scope:** Merchant-managed Commercial Registration and VAT certificate images in AWJ Store.

## 1. Purpose

Define the product and UX baseline for allowing a merchant to attach business-document images to the canonical Commercial Registration and VAT identity already owned by AWJ, and let storefront customers view those documents from the Footer.

This is a separate feature from SBC / منصة الأعمال and must not expand the current SBC V1 scope.

## 2. Source-of-truth boundaries

- Commercial Registration number remains canonical at `Tenant.cr_number`.
- VAT number remains canonical at `Tenant.vat_number`.
- The merchant-uploaded images are supporting documents only.
- Uploading, replacing, or deleting an image must never create, replace, parse, or mutate the canonical CR/VAT numbers.
- Do not create duplicate authoritative CR or VAT fields in Storefront or StorefrontPresentation.

## 3. Merchant settings

AWJ Store settings should provide:

### Commercial Registration
- Display the canonical CR number as read-only identity data.
- Allow the merchant to upload the **Commercial Registration document image**.
- Allow replacing or deleting the uploaded image.
- Provide presentation visibility controls only where separately supported by the Store Footer contract.

### VAT
- Display the canonical VAT number as read-only identity data.
- Allow the merchant to upload the **VAT Registration Certificate image**.
- Allow replacing or deleting the uploaded image.
- Provide presentation visibility controls only where separately supported by the Store Footer contract.

The merchant is the source of the uploaded document image. AWJ does not automatically obtain these document images from a government service in V1.

## 4. Public Storefront Footer

CR and VAT remain part of the Storefront Footer business-information area.

When a corresponding merchant-uploaded document exists:
- the relevant CR/VAT Footer item becomes interactive;
- selecting it opens the associated document image;
- the interaction must remain inside the Storefront experience.

When no document exists:
- the canonical CR/VAT number may still be displayed according to Footer settings;
- do not open an empty viewer;
- do not show a broken-image placeholder;
- do not imply that a document is available.

## 5. Document viewer UX

### Mobile
Use a responsive Modal / Sheet suitable for a document image:
- clear close action;
- document remains readable;
- allow natural zoom/viewing behavior where the implementation safely supports it;
- avoid clipping important certificate content.

### Desktop
Use a centered document viewer / Modal with:
- clear close action;
- sufficient viewport area for the document;
- responsive containment without distorting the image.

The viewer should identify the document context (Commercial Registration or VAT certificate) without introducing a verification-status workflow.

## 6. Upload behavior

The implementation contract must later define:
- supported image formats;
- file-size limits;
- image validation;
- storage disk/object-storage path;
- replacement/deletion lifecycle;
- authorization;
- public delivery strategy;
- cache behavior;
- orphan cleanup.

Do not invent these technical values in this baseline. They require evidence from AWJ's existing media/storage architecture before implementation.

## 7. Security and Tenant Isolation

Mandatory:
- uploads are scoped to the authenticated merchant's Tenant/Storefront context;
- cross-tenant reads, writes, replacement, and deletion fail closed;
- public document delivery must not expose filesystem paths, storage credentials, Tenant IDs, or internal Storefront IDs;
- validate actual uploaded media according to the implementation contract, not filename alone;
- do not allow arbitrary client-supplied tenant authority;
- deleting/replacing a document must not affect another Tenant's media.

## 8. Privacy and presentation boundary

Merchant-uploaded CR/VAT document images can contain more information than the Footer numbers.

Therefore:
- public display must be an explicit Storefront presentation decision;
- the implementation must not make a newly uploaded document public accidentally;
- Preview and Public Storefront must use equivalent visibility semantics;
- no document image should be treated as a source for automatic legal-data extraction in V1.

## 9. Relationship to SBC

SBC / منصة الأعمال remains a separate feature and contract.

This feature must not:
- change SBC `authentication_number`;
- change SBC `show_in_storefront`;
- add SBC verification states;
- bundle SBC assets into CR/VAT document upload;
- delay or expand the current AWJ-SBC-1 implementation.

## 10. Out of scope

Business Documents Viewer V1 does not include:
- OCR or extracting CR/VAT numbers from images;
- government API verification;
- automatic certificate retrieval;
- SBC document upload;
- QR generation;
- VAT verification workflow;
- CR verification workflow;
- licenses or other legal documents;
- WhatsApp/App Store/Google Play/payment-brand work;
- unrelated Footer redesign.

## 11. Acceptance baseline

A future implementation is acceptable only when:
1. CR continues to come from `Tenant.cr_number`;
2. VAT continues to come from `Tenant.vat_number`;
3. merchant can securely upload/replace/delete each supporting document image;
4. uploaded images cannot mutate canonical identity;
5. a document-bearing Footer item opens the correct document viewer;
6. an item without a document never opens an empty/broken viewer;
7. mobile and desktop viewers are responsive and readable;
8. Tenant Isolation is covered by negative tests;
9. public delivery leaks no internal storage/tenant identifiers;
10. legacy stores without uploaded documents continue unchanged.

## 12. Required next step before implementation

Run a focused evidence pass over AWJ's existing product/media/document storage and public-media delivery paths. Then freeze a separate implementation contract covering upload validation, storage, authorization, lifecycle, public access, and tests.

Do not implement this feature as part of AWJ-SBC-1.
