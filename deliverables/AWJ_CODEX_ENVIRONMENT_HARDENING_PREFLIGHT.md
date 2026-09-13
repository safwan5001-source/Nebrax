# AWJ Codex Environment Hardening — Preflight

**تاريخ الفحص:** 2026-09-13
**نطاق الفحص:** فحص فقط؛ لم يتم تثبيت أو إصلاح أي مكوّن، ولم يتم تنفيذ push أو merge أو deploy.

## ملخص البيئة

| البند | القيمة |
|---|---|
| Working directory | `/workspace/Nebrax` |
| Branch | `work` |
| HEAD SHA | `428adecbf15bded8f3876b279afc5dc417935291` |
| Laravel app path | `/root/nibras-app` |
| Laravel version | `11.56.1` |

## مخرجات Git

### `pwd`

```text
/workspace/Nebrax
```

### `git status --short --branch`

```text
## work
```

كانت شجرة العمل نظيفة وقت الفحص، ولم تظهر ملفات معدلة أو غير متتبعة.

### `git remote -v`

لم يُرجع الأمر أي مخرجات؛ لا يوجد remote باسم `origin` أو أي remote آخر.

### `git rev-parse HEAD`

```text
428adecbf15bded8f3876b279afc5dc417935291
```

## أدوات البيئة

### PHP — PASS

الأمر: `php --version`

```text
PHP 8.4.22-dev (cli) (built: May  2 2026 20:37:25) (NTS)
Copyright (c) The PHP Group
Zend Engine v4.4.22-dev, Copyright (c) Zend Technologies
    with Zend OPcache v8.4.22-dev, Copyright (c), by Zend Technologies
    with Xdebug v3.5.2-dev, Copyright (c) 2002-2026, by Derick Rethans
```

رمز الخروج: `0`.

### Composer — PASS

الأمر: `composer --version`

```text
Composer plugins have been disabled for safety in this non-interactive session.
Set COMPOSER_ALLOW_SUPERUSER=1 if you want to allow plugins to run as root/super user.
Do not run Composer as root/super user! See https://getcomposer.org/root for details
PHP version 8.4.22-dev (/root/.phpenv/versions/8.4snapshot/bin/php)
Run the "diagnose" command to get more detailed diagnostics output.
Composer version 2.9.7 2026-04-14 13:31:52
```

رمز الخروج: `0`. رسائل التشغيل بواسطة المستخدم `root` وتعطيل plugins تحذيرات وليست فشلًا في فحص الإصدار.

### xmllint — FAIL

الأمر: `xmllint --version`

```text
/bin/bash: line 1: xmllint: command not found
```

رمز الخروج: `127`.

- **السبب المحتمل:** أداة `xmllint`، أو الحزمة التي توفرها، غير مثبتة أو غير موجودة ضمن `PATH`.
- **الإجراء المتخذ:** لم تتم محاولة تثبيتها أو إصلاحها.

### SQLite — PASS

الأمر: `sqlite3 --version`

```text
3.45.1 2024-01-30 16:01:20 e876e51a0ed5c5b3126f52e532044363a014bc594cfefa87ffb5b82257ccalt1 (64-bit)
```

رمز الخروج: `0`.

### Node — PASS

الأمر: `node --version`

```text
v20.20.2
```

رمز الخروج: `0`.

### npm — PASS

الأمر: `npm --version`

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
11.4.2
```

رمز الخروج: `0`. تحذير `http-proxy` لا يمنع تشغيل npm حاليًا.

## Laravel app وartisan

يحدد `.cursor/install.sh` المسار بواسطة `NIBRAS_APP_DIR`، ويستخدم `$HOME/nibras-app` افتراضيًا. لم يكن `NIBRAS_APP_DIR` معرفًا وقت الفحص، ولذلك كان المسار الناتج:

```text
NIBRAS_APP_DIR=<unset>
APP_DIR=/root/nibras-app
artisan exists: /root/nibras-app/artisan
```

### `php artisan --version` — PASS

نُفّذ من داخل `/root/nibras-app`:

```text
Laravel Framework 11.56.1
```

رمز الخروج: `0`.

## الاختبار المركز

### `php artisan test --filter=SalesChannelTest` — FAIL

نُفّذ من داخل `/root/nibras-app`، وانتهى برمز خروج `255`.

رسالة الخطأ الأصلية:

```text
PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 524288 bytes) in /root/nibras-app/routes/api.php on line 729
```

ظهر أيضًا خطأ ثانوي أثناء محاولة تسجيل الخطأ الأساسي:

```text
PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 65536 bytes) in /root/nibras-app/vendor/monolog/monolog/src/Monolog/Formatter/NormalizerFormatter.php on line 388
```

- **السبب المحتمل:** وصلت عملية PHPUnit إلى حد ذاكرة PHP البالغ `134217728` بايت (`128 MiB`) أثناء تهيئة التطبيق أو تحميل `routes/api.php`. ثم احتاج تسجيل الخطأ عبر Monolog إلى ذاكرة إضافية وفشل بدوره.
- ظهرت تحذيرات PHPUnit بشأن metadata داخل doc-comments، لكنها ليست سبب رمز الخروج `255`.
- **الإجراء المتخذ:** لم يتم تغيير حد الذاكرة أو أي إعداد أو ملف، ولم تتم محاولة إصلاح الفشل.

## الوصول إلى GitHub

### Git origin — FAIL

لم يُظهر `git remote -v` أي remote.

- **السبب المحتمل:** تم توفير checkout بلا إعدادات remotes.
- **الإجراء المتخذ:** لم تتم إضافة `origin`.

### GitHub network — FAIL / غير قابل للتحقق بالأمر المطلوب

كان فحص `git ls-remote origin HEAD` مشروطًا بوجود `origin`. النتيجة:

```text
origin is not configured; command not run.
```

- **السبب المحتمل:** لا يوجد `origin` يمكن استخدام عنوانه لاختبار الاتصال.
- لا تثبت هذه النتيجة وجود عطل شبكي عام؛ بل تعني أن الوصول إلى GitHub لم يمكن إثباته عبر الأمر المحدد.

### GitHub authentication — FAIL

الأمر: `gh auth status`

```text
You are not logged into any GitHub hosts. To log in, run: gh auth login
```

رمز الخروج: `1`.

- أداة `gh` مثبتة وقابلة للتشغيل، لكن لا توجد جلسة مصادقة مسجلة.
- **الإجراء المتخذ:** لم تتم محاولة تسجيل الدخول.

## جدول PASS/FAIL النهائي

| النقطة | النتيجة | التفاصيل |
|---|---:|---|
| Fresh checkout | **PASS** | أظهر `git status --short --branch` الفرع فقط؛ شجرة العمل كانت نظيفة وقت الفحص |
| Git origin | **FAIL** | لم يُرجع `git remote -v` أي remote |
| GitHub network | **FAIL** | تعذر إجراء الفحص المحدد لعدم وجود `origin` |
| GitHub authentication | **FAIL** | `gh auth status` أكد عدم تسجيل الدخول |
| PHP | **PASS** | `8.4.22-dev` |
| Composer | **PASS** | `2.9.7` |
| xmllint | **FAIL** | `xmllint: command not found` |
| SQLite | **PASS** | `3.45.1` |
| Node | **PASS** | `v20.20.2` |
| npm | **PASS** | `11.4.2`، مع تحذير config غير مانع |
| Laravel artisan | **PASS** | Laravel Framework `11.56.1` |
| SalesChannelTest | **FAIL** | نفاد حد ذاكرة PHP البالغ `128 MiB`؛ رمز الخروج `255` |

## الاستنتاج

- **Branch:** `work`
- **HEAD SHA وقت الفحص:** `428adecbf15bded8f3876b279afc5dc417935291`
- **Laravel app path:** `/root/nibras-app`
- **هل البيئة مناسبة لتشغيل اختبارات AWJ محليًا؟** لا، ليست مناسبة بالكامل حاليًا؛ `xmllint` غير متاح والاختبار المركز يفشل بسبب نفاد ذاكرة PHP.
- **هل Codex يستطيع الوصول إلى GitHub؟** غير مثبت عبر الفحص المطلوب، لأن `origin` غير مهيأ.
- **هل Codex يستطيع المصادقة والدفع إلى GitHub؟** لا وفق الحالة الحالية؛ GitHub CLI غير مصادق ولا يوجد `origin` للدفع إليه.
- لم يتم تطبيق أي إصلاح للفشل المكتشف.
