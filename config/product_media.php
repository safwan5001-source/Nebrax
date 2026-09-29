<?php

return [
    // توجيه وسائط المنتج الجديدة إلى R2 (AWJ-R2-4). عند false (الافتراضي) يبقى
    // الرفع الجديد على مساره الحالي (DocumentStorageService) بلا أي تغيير
    // سلوكي — أداة تراجع فورية عبر متغيّر بيئة بلا نشر كودٍ جديد.
    'r2' => [
        'enabled' => filter_var(env('PRODUCT_MEDIA_R2_ENABLED', false), FILTER_VALIDATE_BOOL),
    ],
];
