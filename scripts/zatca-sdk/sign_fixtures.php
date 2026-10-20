<?php

declare(strict_types=1);

/*
 * REM-17 — signs the AWJ SDK fixtures with AWJ's own production signing classes and an EPHEMERAL synthetic
 * secp256k1 credential, so the advisory SDK job can validate SIGNATURE / QR / PIH on real AWJ output.
 *
 *   php scripts/zatca-sdk/sign_fixtures.php <tests/Fixtures/zatca-sdk/awj> <out-dir>
 *
 * Writes <out-dir>/signed/*.xml and <out-dir>/certificate/{cert.pem, ec-secp256k1-priv-key.pem} in the SDK's
 * file format (Base64 body, no armour) for the second SDK config the harness builds. The CA, the leaf and the
 * private key are generated in memory for this run only: never committed, never printed, never a ZATCA
 * credential. The signature policy values are synthetic placeholders (the SDK does not check them); production
 * still fails closed until the official policy is configured.
 *
 * No Laravel bootstrap: the signing classes are plain PHP and are loaded straight from app/.
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\Services\\Accounting\\';
    if (str_starts_with($class, $prefix)) {
        $file = dirname(__DIR__, 2).'/app/Services/Accounting/'.substr($class, strlen($prefix)).'.php';
        if (is_file($file)) {
            require $file;
        }
    }
});

use App\Services\Accounting\ZatcaCertificateFields;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaPhaseTwoQrEncoder;
use App\Services\Accounting\ZatcaQrCertificateMaterialExtractor;
use App\Services\Accounting\ZatcaSignedInvoiceQrMaterialExtractor;
use App\Services\Accounting\ZatcaXadesSignatureAssembler;
use App\Services\Accounting\ZatcaXadesSignedPropertiesBuilder;
use App\Services\Accounting\ZatcaXmlCanonicalizer;
use App\Services\Accounting\ZatcaXmlDsigSignedInfoBuilder;
use App\Services\Accounting\ZatcaXmlEcdsaSigner;

const SYNTHETIC_POLICY_IDENTIFIER = 'https://awj.invalid/zatca-sdk/synthetic-signature-policy';

function fail(string $message): never
{
    fwrite(STDERR, "sign_fixtures: {$message}\n");
    exit(3);
}

/** @return array{0:OpenSSLAsymmetricKey, 1:OpenSSLCertificate} */
function syntheticCertificate(string $commonName, ?OpenSSLCertificate $issuer, ?OpenSSLAsymmetricKey $issuerKey, bool $ca): array
{
    $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
    if ($key === false) {
        fail('cannot generate a secp256k1 key');
    }
    $config = sys_get_temp_dir().'/awj-sign-fixtures-'.bin2hex(random_bytes(6)).'.cnf';
    file_put_contents($config, "[req]\ndistinguished_name=dn\n[dn]\n[ext]\nbasicConstraints=critical,CA:".($ca ? 'TRUE' : 'FALSE')."\n");
    try {
        $options = ['digest_alg' => 'sha256', 'config' => $config, 'x509_extensions' => 'ext'];
        $csr = openssl_csr_new(['countryName' => 'SA', 'organizationName' => 'AWJ Synthetic Test', 'commonName' => $commonName], $key, $options);
        $certificate = $csr === false ? false : openssl_csr_sign($csr, $issuer, $issuerKey ?? $key, 2, $options, random_int(1, PHP_INT_MAX));
    } finally {
        @unlink($config);
    }
    if ($certificate === false) {
        fail("cannot issue the synthetic certificate {$commonName}");
    }

    return [$key, $certificate];
}

function body(string $armoured): string
{
    return (string) preg_replace('/-----[^-]+-----|\s+/', '', $armoured);
}

function text(DOMXPath $xpath, string $query): string
{
    $nodes = $xpath->query($query);
    if ($nodes === false || $nodes->length !== 1) {
        fail("fixture field not found exactly once: {$query}");
    }

    return trim((string) $nodes->item(0)?->textContent);
}

[$script, $fixturesDir, $outDir] = $argv + [null, null, null];
if (! is_string($fixturesDir) || ! is_dir($fixturesDir) || ! is_string($outDir)) {
    fail("usage: php {$script} <fixtures-awj-dir> <out-dir>");
}
foreach (['signed', 'certificate'] as $sub) {
    if (! is_dir("{$outDir}/{$sub}") && ! mkdir("{$outDir}/{$sub}", 0700, true)) {
        fail("cannot create {$outDir}/{$sub}");
    }
}

[$caKey, $caCertificate] = syntheticCertificate('AWJ-SYNTHETIC-EPHEMERAL-CA', null, null, true);
[$leafKey, $leafCertificate] = syntheticCertificate('AWJ-SYNTHETIC-EPHEMERAL-EGS', $caCertificate, $caKey, false);
openssl_x509_export($leafCertificate, $leafPem);
openssl_x509_export($caCertificate, $caPem);
openssl_pkey_export($leafKey, $leafKeyPem);
$chain = [body($leafPem), body($caPem)];

// The SDK compares IssuerSerial with the certificate its config points at: the synthetic leaf.
file_put_contents("{$outDir}/certificate/cert.pem", $chain[0]);
file_put_contents("{$outDir}/certificate/ec-secp256k1-priv-key.pem", body($leafKeyPem));
chmod("{$outDir}/certificate/ec-secp256k1-priv-key.pem", 0600);

$hasher = new ZatcaInvoiceHasher(new ZatcaXmlCanonicalizer());
$signer = new ZatcaXmlEcdsaSigner();
$signedProperties = new ZatcaXadesSignedPropertiesBuilder();
$assembler = new ZatcaXadesSignatureAssembler($hasher, $signedProperties, new ZatcaXmlDsigSignedInfoBuilder(), $signer);
$extractor = new ZatcaSignedInvoiceQrMaterialExtractor($hasher, $signer, $signedProperties, new ZatcaCertificateFields());
$certificateMaterial = (new ZatcaQrCertificateMaterialExtractor())->extract($chain[0]);
$encoder = new ZatcaPhaseTwoQrEncoder();
$policyDigest = base64_encode(hash('sha256', SYNTHETIC_POLICY_IDENTIFIER, true));

$files = glob(rtrim($fixturesDir, '/').'/*.xml') ?: [];
if ($files === []) {
    fail("no fixtures in {$fixturesDir}");
}
foreach ($files as $file) {
    $xml = (string) file_get_contents($file);
    $document = new DOMDocument();
    if (! $document->loadXML($xml, LIBXML_NONET)) {
        fail(basename($file).': not well-formed');
    }
    $xpath = new DOMXPath($document);
    $xpath->registerNamespace('inv', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
    $xpath->registerNamespace('cac', 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2');
    $xpath->registerNamespace('cbc', 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2');

    $typeName = (string) $xpath->evaluate('string(/inv:Invoice/cbc:InvoiceTypeCode/@name)');
    $documentType = str_starts_with($typeName, '02') ? 'simplified' : 'standard';
    $issuedAt = new DateTimeImmutable(
        text($xpath, '/inv:Invoice/cbc:IssueDate').' '.text($xpath, '/inv:Invoice/cbc:IssueTime'),
        new DateTimeZone('Asia/Riyadh'),
    );
    $currentQr = text($xpath, "/inv:Invoice/cac:AdditionalDocumentReference[cbc:ID='QR']/cac:Attachment/cbc:EmbeddedDocumentBinaryObject");

    $signed = $assembler->assemble($xml, $chain, $leafKeyPem, new DateTimeImmutable('now', new DateTimeZone('UTC')), SYNTHETIC_POLICY_IDENTIFIER, $policyDigest);
    $material = $extractor->extract($signed);
    $qr = $encoder->encode(
        text($xpath, '/inv:Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName'),
        text($xpath, '/inv:Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID'),
        $issuedAt,
        text($xpath, '/inv:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount'),
        text($xpath, '/inv:Invoice/cac:TaxTotal[1]/cbc:TaxAmount'),
        $material['invoice_digest'],
        $material['signature_value'],
        $certificateMaterial['public_key'],
        $documentType,
        $documentType === 'simplified' ? $certificateMaterial['certificate_signature'] : null,
    );

    $needle = '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">'.htmlspecialchars($currentQr, ENT_XML1 | ENT_QUOTES, 'UTF-8').'</cbc:EmbeddedDocumentBinaryObject>';
    if (substr_count($signed, $needle) !== 1) {
        fail(basename($file).': QR placeholder not found exactly once');
    }
    $final = str_replace($needle, '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">'.$qr.'</cbc:EmbeddedDocumentBinaryObject>', $signed);
    if (! hash_equals($material['signature_value'], $extractor->extract($final)['signature_value'])) {
        fail(basename($file).': QR replacement changed the signed material');
    }

    file_put_contents("{$outDir}/signed/".basename($file), $final);
    echo 'signed '.basename($file)." ({$documentType})\n";
}
