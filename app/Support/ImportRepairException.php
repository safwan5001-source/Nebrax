<?php

namespace App\Support;

/**
 * رفضٌ لطلب إصلاح (IMP-H1-S8b) برمزٍ ثابتٍ تترجمه الواجهة: `repair_not_available` · `repair_ref_missing` · `repair_ref_unknown` ·
 * `repair_ref_duplicate` · `repair_ref_not_failed` · `repair_branch_mismatch` · `repair_csv_quote_prefix` · `repair_domain_unsupported`.
 * يرث `ImportPreviewException` فيظهر 422 `{message, code}` بلا تبليغ خادم.
 */
class ImportRepairException extends ImportPreviewException {}
