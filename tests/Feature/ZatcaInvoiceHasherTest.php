<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaInvoiceHasher;
use RuntimeException;
use Tests\TestCase;

class ZatcaInvoiceHasherTest extends TestCase
{
    /** @test */
    public function excluded_signature_extension_and_qr_nodes_do_not_change_the_hash(): void
    {
        $hasher = app(ZatcaInvoiceHasher::class);

        $first = $this->invoiceXml('INV-1', 'extension-a', 'signature-a', 'qr-a');
        $sameBusinessInvoice = $this->invoiceXml('INV-1', 'extension-b', 'signature-b', 'qr-b');

        $this->assertSame($hasher->hash($first), $hasher->hash($sameBusinessInvoice));
        $this->assertNotSame('', $hasher->canonicalize($first));
        $this->assertStringNotContainsString('comment-to-remove', $hasher->canonicalize($first));
    }

    /** @test */
    public function changing_business_content_changes_the_hash(): void
    {
        $hasher = app(ZatcaInvoiceHasher::class);

        $this->assertNotSame(
            $hasher->hash($this->invoiceXml('INV-1', 'extension', 'signature', 'qr')),
            $hasher->hash($this->invoiceXml('INV-2', 'extension', 'signature', 'qr'))
        );
    }

    /** @test */
    public function dtd_documents_are_rejected_before_canonicalization(): void
    {
        $this->expectException(RuntimeException::class);

        app(ZatcaInvoiceHasher::class)->hash(
            '<!DOCTYPE Invoice [<!ENTITY value "INV-1">]><Invoice>&value;</Invoice>'
        );
    }

    private function invoiceXml(string $id, string $extension, string $signature, string $qr): string
    {
        return <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <ext:UBLExtensions><ext:UBLExtension>{$extension}</ext:UBLExtension></ext:UBLExtensions>
  <!-- comment-to-remove -->
  <cbc:ID>{$id}</cbc:ID>
  <cac:Signature><cbc:ID>{$signature}</cbc:ID></cac:Signature>
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject>{$qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>
</Invoice>
XML;
    }
}
