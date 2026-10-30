# WEB-RBAC-01 — تسميات المجال `wholesale` في إدارة الأدوار

**السبب الجذري:** `7cb5843` أضاف الصلاحية `commerce.wholesale.manage` في `app/Support/Rbac.php`، فصار المجال `wholesale` في `Rbac::PERMISSIONS` بلا مدخل في `hr.perm_areas`. حارس الانجراف `web/src/modules/roles/catalog.test.ts` (en وar) فشل، ولم يُكتشف لأن Web CI لا يشمل `app/Support/Rbac.php` في مساراته. الوحدة `commerce` والفعل `manage` كانا مُسمَّيين أصلاً.

**التحقق من بقاء المشكلة:** على `origin/main` (= `7cb5843`) فشل اختبارا `catalog.test.ts` (المجال المفقود: `wholesale`).

**التغيير (سطر لكل لغة، لا غير):**
- `web/src/messages/en.json`: `hr.perm_areas.wholesale = "Wholesale"`, `hr.perm_areas.channel_settings = "Channel settings"`
- `web/src/messages/ar.json`: `hr.perm_areas.wholesale = "الجملة"`, `hr.perm_areas.channel_settings = "إعدادات القناة"`

**تحديث بعد أول CI:** تقدّم `main` بـ`caba634` (Batch F) فأضاف `commerce.channel_settings.manage` بلا تسمية لمجال `channel_settings`، فأفشل CI merge-ref بالعيب نفسه؛ أضيفت تسميته (rebase على `caba634`). تسمية `wholesale` كانت ناجحة.

لا تغيير في أسماء الصلاحيات أو RBAC أو API أو قاعدة البيانات أو Treasury أو Railway.

**الاختبارات:**
| فحص | النتيجة |
|---|---|
| اختبارات الأدوار (`modules/roles`, `components/roles`, صفحة الأدوار) | 7 ملفات / 88 اختباراً ناجحة |
| Vitest الكامل | 750 ملفاً / 8923 اختباراً ناجحة (قبل الإصلاح: اختباران فاشلان) |
| `npm run build` (Next 15.5.19، Node 22.22) | نجح exit 0 |
| `tsc --noEmit` مستقلاً | 55 خطأ في ملفات اختبار **موجودة على main بدون تغييري** (العدد نفسه قبل/بعد)؛ فحص الأنواع داخل `next build` ناجح |

**عدم ظهور مفاتيح خام:** حارس التغطية الآن يؤكد أن كل وحدة وفعل ومجال في `Rbac::PERMISSIONS` له تسمية en/ar.

**المخاطر:** منخفضة جداً (نصوص عرض فقط). **المتبقي:** إضافة مسارات `app/Support/Rbac.php` وأخواتها إلى `web-ci.yml` كي لا يتكرر الانجراف بصمت (PR مستقل، انظر `AWJ-RAILWAY-WEB-BUILD-CONFIG-AUDIT.md` §1.4). **CI:** يُسجَّل في PR.
