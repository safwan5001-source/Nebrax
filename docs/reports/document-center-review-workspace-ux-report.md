# تقرير تنفيذ — Complete Document Center Review Workspace UX

**التاريخ:** 2026-08-29  
**PR:** [#565](https://github.com/safwan5001-source/Nebrax/pull/565)  
**الفرع:** `cursor/complete-document-center-review-ux-6a0f`  
**Base SHA:** `a7d24fe1` (أحدث `main` بعد دمج #564)  
**Head SHA:** `9439db3` + إصلاحات مراجعة PR #565 (محلي — بانتظار commit/push)  
**الحالة:** Draft — بانتظار المراجعة (لم يُدمج ولم يُنشر)

---

## 1. الملخص التنفيذي

أُكملت تجربة **Review Workspace** لمركز المستندات عبر إعادة هيكلة الواجهة، توسيع عقد المراجعة في الـbackend (بنود السطور + تحذيرات + ملخص المعالجة)، وربط كل الإجراءات بـAPIs الموجودة فعليًا — دون تفعيل AI/storage/workers ودون أي أثر محاسبي. النهاية دائمًا **Draft فقط**.

---

## 2. Gap Matrix

| القدرة | Backend | Frontend (قبل) | القرار / الحالة |
|--------|---------|----------------|-----------------|
| معاينة مضمّنة (PDF/image) | signed URL موجود | يفتح tab جديد فقط | **مبني** — `DocumentPreviewPanel` |
| بنود السطور (lines) | schema + edits (`lines.N.*`) | غير معروض | **مبني** — API `lines` + `LineItemsPanel` |
| تحذيرات الاستخراج | `normalized_payload.warnings` | غير معروض | **مبني** — API + `IssuesWarningsPanel` |
| تعيين المراجع | `POST assign-reviewer` + `GET eligible-reviewers` | كان يعتمد `GET /users` | **مُصلَح** — مصدر مراجعين من الخادم بصلاحية `manage` فقط |
| Purchase draft options | `warehouse_id`, `cost_center_id` | لا dialog | **مبني** — `PurchaseDraftDialog` |
| Draft preview summary | مشتق من review payload | غير موجود | **مبني** — `DraftPreviewDialog` |
| فلاتر: reviewer/date/channel/status | مدعوم في `index` | جزئي | **مبني** — dialog + URL sync |
| فلاتر: branch | عزل عبر `SetBranch` | — | عرض الفرع النشط فقط (لا filter وهمي) |
| فلاتر: customer/supplier | غير مدعوم | — | **Gap** — لا client-side وهمي |
| فلاتر: uploaded_by | غير مدعوم | — | **Gap** |
| فلاتر: confidence band | غير مدعوم | — | **Gap** |
| فلاتر: draft created | `status=draft_created` | غير في القائمة | **مبني** — خيار status |
| فلاتر: status_group | `status_group=inbox\|review\|...` | client-side وهمي | **مُصلَح** — فلترة خادمية عبر `DocumentWorkflowStatusGroup` |
| مراجعة حزمة قيد المعالجة | extraction غير جاهز | 404/خطأ | **مُصلَح** — `review_mode=shell` + `capabilities.review_shell` |
| Bulk actions | لا endpoint مجمّع | — | **مبني** — sequential `assign-reviewer` + partial success |
| Error/retry في المراجعة | diagnostics + operations | منفصل | **مبني** — `ReviewStatusBanner` + رابط retry/diagnostics |
| Settings tenant | governance + ops | لا صفحة | **مبني** — `/documents/settings` (read-only) |
| Demo موسّع | — | سيناريohan فقط | **مبني** — fixtures موسّعة |
| Delivery note bundle | `/delivery-notes/invoice-draft*` | wizard موجود | **محسّن** — summary قبل build |
| Document Center → DN draft | غير موجود | — | **Gap مقصود** — لا domain جديد |
| رفع مستندات (intake) | APIs موجودة | مبني مسبقًا على main | خارج نطاق هذه المهمة |

---

## 3. ما تم بناؤه (UI)

### Review Workspace 2.0

- **`web/src/components/document-center/review-workspace.tsx`** — orchestrator رئيسي
- **`document-preview-panel.tsx`** — معاينة آمنة (iframe/img) + fallbacks حسب `scan_status`
- **`extracted-fields-panel.tsx`** — حقول header + confidence + تعديل
- **`line-items-panel.tsx`** — جدول desktop / بطاقات mobile + تعديل الحقول المسموحة
- **`matching-panel.tsx`** — مطابقات مع حالات unresolved/warning
- **`issues-warnings-panel.tsx`** — مشكلات + تحذيرات الاستخراج
- **`review-history-panel.tsx`** — سجل المراجعة
- **`review-status-banner.tsx`** — حالة المعالجة + روابط diagnostics/retry

### تعيين المراجع

- **`reviewer-assignment-dialog.tsx`** — assign/change/clear عبر `POST assign-reviewer`
- قائمة المراجعين من `GET /document-batches/{id}/eligible-reviewers` (بدون `users.view`)

### إنشاء المسودة

- **`draft-preview-dialog.tsx`** — ملخص قبل الإنشاء (totals, lines, warnings, blockers)
- **`purchase-draft-dialog.tsx`** — warehouse + cost center (مثل expense)
- **`expense-draft-dialog.tsx`** — موجود مسبقًا، مُعاد استخدامه

### قائمة الحزم

- فلاتر متقدمة: reviewer, date range, channel, status
- **URL deep links:** `?status=ready_for_draft&document_type=expense&...`
- **Bulk selection:** assign reviewer / clear reviewer (sequential APIs + نتيجة جزئية)
- **`document-batch-filters-dialog.tsx`**, **`bulk-reviewer-dialog.tsx`**

### إعدادات

- **`web/src/app/(app)/documents/settings/page.tsx`** — read-only:
  - provider network **locked**
  - storage status
  - processing summary
  - retention policy

### Delivery Notes Bundle (module منفصل)

- تحسين **`delivery-note-invoice-draft-wizard.tsx`**: ملخص المصادر وعدد السطور قبل build

### عقود ومساعدات

- **`web/src/modules/document-center/contract.ts`** — أنواع Review/List/Filters
- **`web/src/lib/document-review-format.ts`** — تنسيق مبالغ `*_minor`
- توسيع **`web/src/lib/document-review.ts`** — مفاتيح ترجمة + confidence tones

---

## 4. تغييرات Backend (minimal)

### الملفات

| الملف | التغيير |
|-------|---------|
| `app/Http/Controllers/Api/DocumentReviewController.php` | `lines()`, `warnings()`, `processingSummary()`, `status_group`, shell review, `eligibleReviewers*` |
| `app/Http/Resources/DocumentReviewResource.php` | حقول `lines`, `warnings`, `processing_summary`, `review_mode` |
| `app/Services/DocumentCenter/DocumentReviewerEligibilityService.php` | مرشحو المراجعة (فرع + `documents.center.review`) |
| `app/Support/DocumentWorkflowStatusGroup.php` | مجموعات الحالة لـ `status_group` |
| `routes/api.php` | `GET document-batches/eligible-reviewers` (+ per-batch) |
| `tests/Feature/DocumentReviewPayloadTest.php` | اختبار العقد الجديد + عزل + لا raw provider |
| `tests/Feature/DocumentReviewerEligibilityTest.php` | عقد eligible-reviewers + رفض إسناد خارج الفرع |
| `tests/Feature/DocumentReviewShellTest.php` | shell payload لـ processing/failed بلا extraction |
| `tests/Feature/DocumentReviewListTest.php` | `status_group` + pagination meta + stale 409 |

### عقد `GET /document-batches/{id}/review` — إضافات

```json
{
  "lines": [{ "index", "description", "fields", "confidence_basis_points", "product_match_id", "unit_match_id" }],
  "warnings": ["string"],
  "processing_summary": {
    "scan_status", "download_available", "workflow_status",
    "processing_key", "processing_message", "retry_available", "diagnostics_url"
  }
}
```

---

## 5. APIs المعاد استخدامها (بدون اختراع)

### مراجعة

| Method | Path | الغرض |
|--------|------|-------|
| GET | `/document-batches` | قائمة مع فلاتر |
| GET | `/document-batches/{id}/review` | payload المراجعة الكامل |
| POST | `/document-batches/{id}/review-changes` | تصحيح حقل/سطر |
| POST | `/document-match-results/{id}/confirm` | تأكيد مطابقة |
| POST | `/document-match-results/{id}/reject` | رفض مطابقة |
| POST | `/document-issues/{id}/resolve` | حل مشكلة |
| POST | `/document-issues/{id}/reopen` | إعادة فتح |
| POST | `/document-batches/{id}/revalidate-financial` | إعادة تحقق مالي |
| POST | `/document-batches/{id}/complete-review` | إكمال المراجعة |
| POST | `/document-batches/{id}/assign-reviewer` | تعيين/إلغاء مراجع |
| POST | `/document-batches/{id}/create-purchase-draft` | مسودة مشتريات |
| POST | `/document-batches/{id}/create-expense-draft` | مسودة مصروف |

### ملفات وعمليات

| Method | Path | الغرض |
|--------|------|-------|
| GET | `/document-files/{id}/download-url` | معاينة آمنة |
| GET | `/document-operations` | ملخص المعالجة |
| GET | `/document-governance` | سياسة الاحتفاظ |
| GET | `/document-batches/{id}/diagnostics` | تشخيص الحزمة |
| POST | `/document-processing-runs/{id}/retry` | إعادة محاولة (operations) |

### مراجع ومسودات

| Method | Path | الغرض |
|--------|------|-------|
| GET | `/document-batches/eligible-reviewers` | مراجعون مؤهلون للفرع النشط (`manage`) |
| GET | `/document-batches/{id}/eligible-reviewers` | مراجعون مؤهلون لحزمة محددة |
| GET | `/warehouses` | مخازن لمسودة المشتريات |
| GET | `/cost-centers` | مراكز تكلفة |
| GET | `/accounts` | حسابات المصروف |
| GET | `/expense-categories` | تصنيفات المصروف |

### Delivery Notes (منفصل)

| Method | Path | الغرض |
|--------|------|-------|
| POST | `/delivery-notes/invoice-draft/preview` | معاينة bundle |
| POST | `/delivery-notes/invoice-draft` | إنشاء مسودة فاتورة |

---

## 6. Workflow المدعوم

```
upload → processing/extraction → needs_review
  → matching + validation + human corrections
  → complete-review → ready_for_draft
  → create-purchase-draft | create-expense-draft (Draft فقط)
```

**غير مدعوم من Document Center:** sales invoice draft، delivery note draft، auto-post، auto-approve.

---

## 7. نتائج الاختبارات

| الاختبار | النتيجة | ملاحظات |
|----------|---------|---------|
| `npm run build` | ⏳ | لم يُشغَّل — بيئة الـ VM: `spawn /bin/bash ENOENT` (`/usr/bin/bash` موجود) |
| Vitest — `web/` | ⏳ | نفس العائق |
| `php artisan test --filter='DocumentReview\|DocumentReviewer'` | ⏳ | يتطلب تجميع Laravel في `/tmp/nibras-app` |
| `git diff --check` | ⏳ | يتطلب shell |
| GitHub CI (PR #565) | ⏳ | يُحدَّث بعد push الإصلاحات |

### أوامر التحقق

```bash
cd /workspace && bash deploy/assemble.sh /workspace /tmp/nibras-app
cd /tmp/nibras-app && php artisan test --filter='DocumentReview|DocumentReviewer'
cd /workspace/web && npm run test && npm run build
git diff --check
```

---

## 8. Commits

| Commit | الوصف |
|--------|-------|
| `14caca23` | feat(documents): add review contract and lines/warnings API payload |
| `c41008d4` | feat(documents): complete review workspace UX with filters, settings, and demo |
| `b2db36bb` | docs: add Document Center Review Workspace UX report |
| `9439db3b` | merge origin/main |
| *(معلّق)* | fix(documents): address PR #565 review — eligibility, shell review, status_group, CI |

---

## 9. Gaps المتبقية

1. **فلاتر customer/supplier** — لا يدعمها `DocumentReviewController::index`
2. **فلاتر uploaded_by** — غير موجود في API
3. **فلاتر confidence band** — غير موجود في API
4. **Document Center → Delivery Note draft** — نطاق منفصل (`/delivery-notes/invoice-draft`)
5. **Bulk backend endpoint** — استُخدمت APIs فردية sequential بدل bridge مجمّع

---

## 10. قيود مقصودة (لم تُخترق)

- `provider_network_enabled=false` — بدون تغيير
- لا OpenAI/Anthropic/Gemini
- لا external storage / Redis / workers / scheduler / ClamAV
- لا `post()` / لا ledger / لا auto-approve / لا auto-post
- لا إنشاء Product/Partner/Unit تلقائيًا
- RBAC + tenant/branch isolation كما هي
- لا expose raw provider payload أو URLs غير موقّعة
- **النهاية دائمًا Draft فقط**

---

## 11. Mobile / RTL / Design System

- تبويبات جوال: preview · details · lines · matches · issues · history
- شريط إجراءات ثابت أسفل الشاشة على الجوال
- RTL-first، `next-intl` ar/en، semantic tokens، IBM Plex Mono للأرقام
- جداول desktop → بطاقات mobile في القائمة والسطور

---

## 12. Demo / Mock

- **`web/src/lib/document-review-demo.ts`** موسّع:
  - `lines`, `warnings`, `processing_summary`
  - handler لـ `assign-reviewer`
  - `demo-batch-003` (processing), `demo-batch-004` (failed)
  - `GET /document-batches/eligible-reviewers`, `GET /warehouses`
  - `review_mode=shell` لـ demo-batch-003/004

تفعيل: `localStorage.setItem('demo', 'true')`

---

## 13. إصلاحات مراجعة PR #565 (post-review)

### أ) أهلية المراجع (Reviewer eligibility)

- **`DocumentReviewerEligibilityService`**: نفس شروط `DocumentReviewService::assign()` — مستخدم نشط + `documents.center.review` + `canAccessBranch`.
- **مسارات جديدة** (محروسة بـ `documents.center.manage`):
  - `GET /api/document-batches/eligible-reviewers`
  - `GET /api/document-batches/{batch}/eligible-reviewers`
- **الواجهة**: `reviewer-assignment-dialog.tsx`، `documents/page.tsx`، و`bulk-reviewer-dialog` تستهلك المصدر الجديد بدل `GET /users` (كان يتطلب `users.view`).
- **اختبار**: `DocumentReviewerEligibilityTest` — قائمة مراجعين صريحة + رفض `assign-reviewer` لمراجع خارج الفرع.

### ب) وضع المراجعة الصدفي (Review shell)

عند غياب `DocumentExtractionResult` (معالجة جارية أو فشل قبل الاستخراج):

- `review_mode: "shell"` مع `fields/lines/matches/issues` فارغة.
- `capabilities.review_shell: true` و`capabilities.review/build_draft: false`.
- `processing_summary` + `diagnostics_url` للحزم الفاشلة.
- **الواجهة**: `review-workspace.tsx` يعطّل التعديل/الإكمال/المسودة في shell mode ويعرض banner المعالجة.

**اختبار**: `DocumentReviewShellTest`.

### ج) فلتر `status_group`

- **`DocumentWorkflowStatusGroup`**: `inbox` · `review` · `ready` · `completed` · `terminal`.
- **`DocumentReviewController::index`**: `?status_group=review` يفلتر خادمياً (مع `meta.total`).
- **الواجهة**: شريط مجموعات الحالة في `/documents` + عقد `contract.ts` (`statusGroup` ↔ `status_group`).

**اختبار**: `DocumentReviewListTest::review_list_supports_server_side_status_group_filtering_with_pagination_meta`.

### د) CI / التجميع

- **Vitest OOM:** `web/package.json` — `NODE_OPTIONS=--max-old-space-size=8192`؛ `web/vitest.config.ts` — `pool: forks`, `poolOptions.forks.singleFork: true`, `maxWorkers: 1`, `fileParallelism: false`؛ `web-ci.yml` — نفس `NODE_OPTIONS`.
- **`DocumentReviewPayloadTest`:** مسار workflow صحيح (`draft → receiving → received → needs_review`) بدل انتقال مباشر مرفوض.
- اختبارات Feature الجديدة تُنسخ تلقائياً عبر `deploy/assemble.sh` و`.github/workflows/ci.yml`.
- في CI: `composer config policy.advisories.block false` لتجاوز حجب Laravel 11 (موجود مسبقاً).

### هـ) أوامر التحقق (بعد push)

```bash
cd web && npm run test && npm run build
php artisan test --filter='DocumentReview|DocumentReviewer'
php artisan test
git diff --check
```

---

*تم إنشاء هذا التقرير تلقائيًا من Cloud Agent — بانتظار مراجعة PR #565.*
