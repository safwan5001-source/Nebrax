# AWJ — PR #1560 PostgreSQL CI Fix

## 1. Root Cause

كان الفشل في الاختبار نفسه، لا في منطق الموافقات أو التطبيق.

التدفق يكتب حدث `consent.updated` عند منح `document_projected_text` كما هو مطلوب. لكن الاختبار كان يقرأ آخر حدث باستخدام `latest('occurred_at')` فقط. في PostgreSQL يمكن أن تتساوى قيمة `now()` لأحداث موافقة متتابعة، وعند التعادل لا يضمن PostgreSQL أي ترتيب بين الصفوف؛ لذلك كان الاختبار يختار حدثًا أقدم (مثل منح `assistant_messages`) ثم يفشل assertion رغم وجود حدث منح المستند.

أكد سجل CI أن الفشل بقي نفسه بعد التغيير الأول غير المؤثر: نفس الاختبار، نفس السطر، ونفس assertion. لذلك أُزيل ذلك التغيير، ولم يُعدّل منطق التطبيق.

## 2. Changes Made

عُدّل الاختبار ليبحث صراحةً داخل أحداث `consent.updated` للمستأجر عن الحدث الذي يحتوي `document_projected_text` في `categories_granted`. هذا يثبت السلوك المطلوب مباشرةً ولا يعتمد على ترتيب زمني غير حتمي في PostgreSQL.

لم تتغير توقعات الموافقة: لا يزال الاختبار يتطلب أن تكون `document_projected_text` مسجلة في `categories_granted`. ولم تتغير أي صلاحيات أو موافقات أو مسارات قراءة أو إرسال.

## 3. Changed Files

- `tests/Feature/AiDocumentProjectionTest.php` — جعل اختيار حدث التدقيق حتميًا في PostgreSQL.
- `docs/reports/implementation/AWJ_PR_1560_POSTGRESQL_FIX_REPORT.md` — هذا التقرير.

صافي التغيير في `app/` **صفر**؛ التغيير الوسيط في `AiAssistantDataCategory.php` أُزيل بعد إثبات أنه لا يعالج الفشل.

## 4. Tests and Results

- `git diff --check`: PASS قبل الرفع.
- الاختبارات المحلية: تعذر تشغيلها؛ بيئة Sandbox لا تحتوي الأمر `php` أو Docker.
- لا يوجد استدعاء حقيقي لـAnthropic API.

الاختبار المستهدف:

```text
php artisan test tests/Feature/AiDocumentProjectionTest.php --filter=the_document_category_cannot_be_granted_while_the_platform_switch_is_off_and_is_never_auto_enabled
```

## 5. CI Status

على الـHEAD السابق `083bda96063edbc2763ab273a79c5a97eff83539`:

- SQLite: PASS
- Web CI: PASS
- PostgreSQL: FAILURE، بنفس assertion في السطر 497
- CI Gate: FAILURE بسبب PostgreSQL

بعد التعديل النهائي يجب انتظار تشغيل CI جديد على الـHEAD النهائي أدناه. لا أعتبره ناجحًا قبل ظهور النتيجة الجديدة من GitHub.

## 6. Security Impact

التغيير في الاختبار فقط، ولا يغيّر سلوك الإنتاج أو صلاحياته أو حالة الموافقات. لا توجد صلاحية جديدة، ولا قراءة أو إرسال بيانات إضافية، ولا تغيير في Tenant Isolation أو RBAC أو Consent Revocation أو Document Redaction أو External Provider Safety.

تبقى استقلالية `assistant_messages` و`financial_summary` و`document_projected_text` وموافقة المزوّد الخارجي وموافقة إرسال المستندات كما هي. كما لم تتغير القواعد المالية أو القيود المحاسبية أو قاعدة البيانات أو APIs.

## 7. Remaining Risks

لا يمكن إثبات نتيجة CI النهائية من البيئة المحلية. يلزم انتظار PostgreSQL وSQLite وWeb وCI Gate على الـHEAD النهائي بعد رفع هذا التعديل.

## 8. Branch / PR / Base SHA / Head SHA

- Branch: `feat/ai-07b-document-qa-20261017`
- PR: `#1560` — `safwan5001-source/Nebrax`
- Base branch: `feat/ai-07-anthropic-gateway-20261017`
- Base SHA: `9db5e3b63cb9d1533ea07792fbbb885cf6406400`
- Original PR HEAD before modification: `882285fc04a5ba3185ac4cd14daa8cacfb4a8c03`
- Final fix commit / PR HEAD for the final code change: `2ebd060f3c020d7b7f67b624f45881d3b43fa213`

## 9. Next Action

رفع التعديل إلى فرع PR #1560 وانتظار CI الجديد. لا Merge ولا Deploy.
