<?php

namespace App\Services\DocumentCenter;

use Illuminate\Validation\ValidationException;
use Symfony\Component\Process\Process;

class PdfPageCounter
{
    public function count(string $path): int
    {
        $process = new Process([(string) config('document_center.intake.pdfinfo_binary', 'pdfinfo'), $path]);
        $process->setTimeout(10);

        try {
            $process->run();
        } catch (\Throwable) {
            throw ValidationException::withMessages(['file' => 'تعذر فحص بنية ملف PDF بأمان.']);
        }

        if (! $process->isSuccessful() || ! preg_match('/^Pages:\s+(\d+)$/mi', $process->getOutput(), $match)) {
            throw ValidationException::withMessages(['file' => 'ملف PDF تالف أو غير مدعوم.']);
        }

        $pages = (int) $match[1];
        $maximum = (int) config('document_center.intake.max_pdf_pages', 50);
        if ($pages < 1 || $pages > $maximum) {
            throw ValidationException::withMessages(['file' => "يجب ألا يتجاوز ملف PDF {$maximum} صفحة."]);
        }

        return $pages;
    }
}
