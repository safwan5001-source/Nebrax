<?php

namespace App\Services\Accounting;

use DOMDocument;
use DOMElement;
use RuntimeException;

final class ZatcaXmlCanonicalizer
{
    public const ALGORITHM = 'http://www.w3.org/2006/12/xml-c14n11';

    private const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
    private const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

    public function __construct(private readonly string $binary = 'xmllint')
    {
    }

    public function canonicalize(string $xml): string
    {
        $this->assertSafeXml($xml);

        $inputPath = tempnam(sys_get_temp_dir(), 'zatca-c14n-');
        if ($inputPath === false) {
            throw new RuntimeException('تعذر إنشاء ملف C14N المؤقت الخاص بـ ZATCA.');
        }

        try {
            if (file_put_contents($inputPath, $xml, LOCK_EX) === false) {
                throw new RuntimeException('تعذر تجهيز XML للتطبيع الخاص بـ ZATCA.');
            }
            @chmod($inputPath, 0600);

            $process = proc_open(
                [$this->binary, '--nonet', '--c14n11', $inputPath],
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
            $canonical = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exitCode = proc_close($process);

            if ($exitCode !== 0) {
                $detail = trim($stderr === false ? '' : $stderr);
                throw new RuntimeException(
                    'فشل محرك C14N 1.1 الخاص بـ ZATCA'
                    .($detail !== '' ? ": {$detail}" : '.')
                );
            }

            if ($canonical === false || $canonical === '') {
                throw new RuntimeException('أعاد محرك C14N 1.1 ناتجاً فارغاً.');
            }

            return $canonical;
        } finally {
            @unlink($inputPath);
        }
    }

    /**
     * يطبّع عنصراً بعد تثبيت namespace context الموروث عليه.
     *
     * C14N شامل، لذلك يجب أن تظهر جميع namespace nodes الموجودة في نطاق العنصر
     * على جذر النسخة المؤقتة كما ستظهر عند التحقق من العنصر داخل المستند النهائي.
     */
    public function canonicalizeElementInContext(DOMElement $element): string
    {
        $ownerDocument = $element->ownerDocument;
        if (
            $ownerDocument === null
            || $ownerDocument->documentElement === null
            || $ownerDocument->doctype !== null
        ) {
            throw new RuntimeException('سياق XML غير صالح لتطبيع عنصر توقيع ZATCA.');
        }

        /** @var list<DOMElement> $lineage */
        $lineage = [];
        for ($node = $element; $node instanceof DOMElement; $node = $node->parentNode) {
            array_unshift($lineage, $node);
        }

        foreach ($lineage as $node) {
            if ($node === $element) {
                continue;
            }

            foreach ($node->attributes as $attribute) {
                if ($attribute->namespaceURI === self::XML_NAMESPACE) {
                    throw new RuntimeException(
                        'خصائص xml:* الموروثة غير مدعومة في سياق توقيع ZATCA.'
                    );
                }
            }
        }

        $xpath = new \DOMXPath($ownerDocument);
        $namespaceNodes = $xpath->query('namespace::*', $element);
        if ($namespaceNodes === false) {
            throw new RuntimeException('تعذر قراءة namespace context لعنصر توقيع ZATCA.');
        }

        /** @var array<string, string> $namespaces */
        $namespaces = [];
        foreach ($namespaceNodes as $namespaceNode) {
            $name = $namespaceNode->nodeName;
            if ($name === 'xmlns:xml') {
                continue;
            }

            $prefix = $name === 'xmlns' ? '' : substr($name, strlen('xmlns:'));
            $namespaces[$prefix] = (string) $namespaceNode->nodeValue;
        }

        $temporary = new DOMDocument('1.0', 'UTF-8');
        $clone = $temporary->importNode($element, true);
        if (! $clone instanceof DOMElement) {
            throw new RuntimeException('تعذر نسخ عنصر توقيع ZATCA للتطبيع.');
        }
        $temporary->appendChild($clone);

        foreach ($namespaces as $prefix => $namespace) {
            $clone->setAttributeNS(
                self::XMLNS_NAMESPACE,
                $prefix === '' ? 'xmlns' : 'xmlns:'.$prefix,
                $namespace
            );
        }

        $xml = $temporary->saveXML($clone);
        if ($xml === false) {
            throw new RuntimeException('تعذر تسلسل عنصر توقيع ZATCA للتطبيع.');
        }

        return $this->canonicalize($xml);
    }

    private function assertSafeXml(string $xml): void
    {
        $previous = libxml_use_internal_errors(true);

        try {
            $document = new DOMDocument();
            $loaded = $document->loadXML(
                $xml,
                LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT
            );

            if (! $loaded || $document->documentElement === null || $document->doctype !== null) {
                throw new RuntimeException('XML غير صالح أو يحتوي DTD غير مسموح لتطبيع ZATCA.');
            }
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }
}
