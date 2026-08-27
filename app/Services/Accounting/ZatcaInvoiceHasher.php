<?php

namespace App\Services\Accounting;

use DOMDocument;
use DOMNode;
use DOMXPath;
use RuntimeException;

/**
 * يطبّق تحويل Hash الرسمي لفاتورة ZATCA:
 * استبعاد UBLExtensions وSignature وQR، حذف التعليقات، ثم C14N 1.1 وSHA-256.
 *
 * PHP DOM لا يتيح اختيار C14N 1.1، لذلك نستدعي محرك libxml2 الرسمي عبر xmllint.
 */
final class ZatcaInvoiceHasher
{
    private const EXT_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
    private const CAC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
    private const CBC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

    public function __construct(private readonly string $binary = 'xmllint')
    {
    }

    public function hash(string $xml): string
    {
        return base64_encode(hash('sha256', $this->canonicalize($xml), true));
    }

    public function canonicalize(string $xml): string
    {
        $document = $this->parseSecurely($xml);
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ext', self::EXT_NS);
        $xpath->registerNamespace('cac', self::CAC_NS);
        $xpath->registerNamespace('cbc', self::CBC_NS);

        foreach ([
            '//ext:UBLExtensions',
            '//cac:Signature',
            "//cac:AdditionalDocumentReference[cbc:ID='QR']",
            '//comment()',
        ] as $expression) {
            $nodes = $xpath->query($expression);
            if ($nodes === false) {
                throw new RuntimeException('تعذر تطبيق تحويل Hash الخاص بـ ZATCA.');
            }

            /** @var list<DOMNode> $toRemove */
            $toRemove = [];
            foreach ($nodes as $node) {
                $toRemove[] = $node;
            }

            foreach ($toRemove as $node) {
                $node->parentNode?->removeChild($node);
            }
        }

        $transformed = $document->saveXML();
        if ($transformed === false) {
            throw new RuntimeException('تعذر تسلسل XML قبل حساب Hash الخاص بـ ZATCA.');
        }

        return $this->canonicalizeWithLibxml($transformed);
    }

    private function parseSecurely(string $xml): DOMDocument
    {
        $previous = libxml_use_internal_errors(true);

        try {
            $document = new DOMDocument();
            $document->preserveWhiteSpace = true;

            $loaded = $document->loadXML(
                $xml,
                LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT
            );

            if (! $loaded || $document->documentElement === null || $document->doctype !== null) {
                throw new RuntimeException('XML غير صالح أو يحتوي DTD غير مسموح لحساب Hash الخاص بـ ZATCA.');
            }

            return $document;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private function canonicalizeWithLibxml(string $xml): string
    {
        $inputPath = tempnam(sys_get_temp_dir(), 'zatca-in-');
        $outputPath = tempnam(sys_get_temp_dir(), 'zatca-out-');

        if ($inputPath === false || $outputPath === false) {
            if (is_string($inputPath)) {
                @unlink($inputPath);
            }
            if (is_string($outputPath)) {
                @unlink($outputPath);
            }

            throw new RuntimeException('تعذر إنشاء ملفات C14N المؤقتة الخاصة بـ ZATCA.');
        }

        try {
            if (file_put_contents($inputPath, $xml, LOCK_EX) === false) {
                throw new RuntimeException('تعذر تجهيز XML لحساب Hash الخاص بـ ZATCA.');
            }
            @chmod($inputPath, 0600);
            @chmod($outputPath, 0600);

            $process = proc_open(
                [$this->binary, '--nonet', '--c14n11', '--output', $outputPath, $inputPath],
                [
                    0 => ['pipe', 'r'],
                    1 => ['pipe', 'w'],
                    2 => ['pipe', 'w'],
                ],
                $pipes
            );

            if (! is_resource($process)) {
                throw new RuntimeException('تعذر تشغيل محرك C14N 1.1 الخاص بـ ZATCA.');
            }

            fclose($pipes[0]);
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exitCode = proc_close($process);

            if ($exitCode !== 0) {
                $detail = trim((string) ($stderr !== '' ? $stderr : $stdout));
                throw new RuntimeException(
                    'فشل محرك C14N 1.1 الخاص بـ ZATCA'
                    . ($detail !== '' ? ": {$detail}" : '.')
                );
            }

            $canonical = file_get_contents($outputPath);
            if ($canonical === false || $canonical === '') {
                throw new RuntimeException('أعاد محرك C14N 1.1 ناتجاً فارغاً.');
            }

            return $canonical;
        } finally {
            @unlink($inputPath);
            @unlink($outputPath);
        }
    }
}
