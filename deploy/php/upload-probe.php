<?php
// AWJ-UPLOAD-PHP-LIMITS-1 — مسبار CI فقط (runtime-smoke.yml).
// يُحقن داخل الحاوية الحية عبر `docker cp` ولا يدخل الصورة ولا مجلد public في المستودع،
// ويكشف ما رآه Apache/mod_php فعلاً (وليس CLI): SAPI + قيم ini + حالة كل ملف مرفوع.
// آخر سطر في الاستجابة JSON دائماً (تحذيرات PHP التمهيدية قد تسبقه).
$files = [];
foreach ($_FILES as $field => $info) {
    $errors = (array) $info['error'];
    $sizes = (array) $info['size'];
    foreach ($errors as $i => $error) {
        $files[] = ['field' => $field, 'i' => $i, 'error' => $error, 'size' => $sizes[$i] ?? 0];
    }
}
echo "\n", json_encode([
    'sapi' => php_sapi_name(),
    'ini' => [
        'upload_max_filesize' => ini_get('upload_max_filesize'),
        'post_max_size' => ini_get('post_max_size'),
        'memory_limit' => ini_get('memory_limit'),
        'max_file_uploads' => ini_get('max_file_uploads'),
        'file_uploads' => ini_get('file_uploads'),
    ],
    'files' => $files,
]), "\n";
