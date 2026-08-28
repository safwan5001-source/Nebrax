<?php

namespace App\Services\Accounting;

use DOMDocument;
use DOMNode;
use DOMXPath;
use RuntimeException;

/**
 * يطبّق تحويل Hash الرسمي لفاتورة ZATCA:
 * استبعاد UBLExtensions وSignature وQR، حذف التعليقات، ثم C14N 1.1 وSHA-256.
 */
final class ZatcaInvoiceHasher
{
    private const EXT_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
    private const CAC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
    private const CBC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

    public function __construct(private readonly ZatcaXmlCanonicalizer $canonicalizer)
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

        return $this->canonicalizer->canonicalize($transformed);
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
}
