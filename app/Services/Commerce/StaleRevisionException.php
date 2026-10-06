<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * FLOWERS-H2-3 — استبدال كامل لمجموعة بُني على نسخةٍ قديمة (غيّرها مدير آخر بعد قراءتها). يُحوَّل في المتحكم إلى 409
 * فلا يُكتب شيء، وتعيد الواجهة قراءة الحالة الحالية.
 */
final class StaleRevisionException extends RuntimeException {}
