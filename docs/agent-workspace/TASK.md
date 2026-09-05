# Active Agent Task

TASK_ID: ORCH-TEST-001
STATUS: APPROVED_FOR_OWNER
OWNER: Safwan
PLANNER_REVIEWER: ChatGPT
IMPLEMENTER: Claude Code

## العنوان

إصلاح عدم تطابق Laravel app المبني بواسطة Claude setup مع مصدر المستودع — `SendZatcaSubmission` كحالة إثبات.

## النتيجة النهائية

اكتملت أول مهمة تنفيذية حقيقية عبر Orchestration V1 وقُبلت تقنياً من المراجع.

السبب الجذري المثبت كان drift في `setup.sh`: آلية assembly المحلية كانت تنشئ/تنسخ `app/Jobs/DocumentCenter` لكنها أغفلت `app/Jobs/Accounting`، بينما `.github/workflows/ci.yml` كان يحتوي مسار Accounting بالفعل.

أصلح Claude Code الفجوة بأصغر تغيير في `setup.sh`، ثم تحقق من إعادة البناء وتحميل `App\Jobs\Accounting\SendZatcaSubmission` ومن الاختبار المركّز. راجع ChatGPT الـdiff والدليل مباشرة وسجل القرار في `REVIEW.md`:

`STATUS: APPROVED_FOR_OWNER`
`DECISION: ACCEPTED`

## التحقق المقبول

- `bash setup.sh`: نجح من إعادة بناء كاملة؛ `LedgerTest` = `5/5`.
- `class_exists('App\\Jobs\\Accounting\\SendZatcaSubmission')`: `true` في التطبيق المبني.
- `ZatcaSubmissionRecoveryTest`: `4/4` ناجح، 27 assertion.
- Full suite: `2363 passed / 25 failed / 1 skipped` — ليست Green، والإخفاقات المتبقية خارج نطاق هذه المهمة.
- لا تغيير في منطق Accounting/ZATCA، ولا DB/API/security/tenant/branch isolation.
- لا Merge ولا Deploy ولا Production Release.

## حالة الـPilot

دورة V1 التشغيلية نجحت:

`READY_FOR_CLAUDE → Claude implementation/report → READY_FOR_REVIEW → ChatGPT review → APPROVED_FOR_OWNER`

GitHub أثبت أنه قناة مشتركة صالحة للتكليف والتقرير والمراجعة. Automatic dispatch/wake-up لم يُحل في V1 ويبقى V2 مستقلة.

## الإغلاق

لا يوجد عمل إضافي مصرح به لـClaude ضمن `ORCH-TEST-001`.

أي مهمة جديدة يجب أن تحصل على `TASK_ID` جديد ونطاق مستقل قبل تغيير الحالة إلى `READY_FOR_CLAUDE`.

## بوابة المالك

`ORCH-TEST-001` متوقفة عند Safwan كـ`APPROVED_FOR_OWNER`.

هذا الإغلاق **لا يصرح** بدمج PR #660 أو Deploy أو Production Release. أي من ذلك يحتاج موافقة Safwan الصريحة.
