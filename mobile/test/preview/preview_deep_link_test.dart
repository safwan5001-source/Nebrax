import 'package:awj_mobile_runtime/preview/preview.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('resolvePreviewExchangeReferenceFromUri', () {
    test('resolves the one allowlisted shape to its reference', () {
      final uri = Uri.parse('https://$kPreviewDeepLinkHost/preview/abc123XYZ');
      expect(resolvePreviewExchangeReferenceFromUri(uri), 'abc123XYZ');
    });

    test('rejects a non-https scheme', () {
      final uri = Uri.parse('http://$kPreviewDeepLinkHost/preview/abc123');
      expect(resolvePreviewExchangeReferenceFromUri(uri), isNull);
    });

    test('rejects the production runtime host — the two allowlists never overlap', () {
      final uri = Uri.parse('https://awj-runtime-proof.example/preview/abc123');
      expect(resolvePreviewExchangeReferenceFromUri(uri), isNull);
    });

    test('rejects an unrecognized path shape', () {
      expect(
        resolvePreviewExchangeReferenceFromUri(Uri.parse('https://$kPreviewDeepLinkHost/home')),
        isNull,
      );
      expect(
        resolvePreviewExchangeReferenceFromUri(Uri.parse('https://$kPreviewDeepLinkHost/preview')),
        isNull,
      );
      expect(
        resolvePreviewExchangeReferenceFromUri(Uri.parse('https://$kPreviewDeepLinkHost/preview/a/b')),
        isNull,
      );
    });

    test('rejects an empty reference segment', () {
      expect(
        resolvePreviewExchangeReferenceFromUri(Uri.parse('https://$kPreviewDeepLinkHost/preview/')),
        isNull,
      );
    });

    test('rejects a reference containing characters outside the allowlisted charset', () {
      expect(
        resolvePreviewExchangeReferenceFromUri(Uri.parse('https://$kPreviewDeepLinkHost/preview/abc-123')),
        isNull,
      );
      expect(
        resolvePreviewExchangeReferenceFromUri(Uri.parse('https://$kPreviewDeepLinkHost/preview/abc%20123')),
        isNull,
      );
    });

    test('rejects a pathologically long reference', () {
      final long = List.filled(200, 'a').join();
      expect(
        resolvePreviewExchangeReferenceFromUri(Uri.parse('https://$kPreviewDeepLinkHost/preview/$long')),
        isNull,
      );
    });

    test('ignores query parameters entirely — never reads them for anything', () {
      final uri = Uri.parse('https://$kPreviewDeepLinkHost/preview/abc123?utm_source=share&token=should-be-ignored');
      expect(resolvePreviewExchangeReferenceFromUri(uri), 'abc123');
    });

    test('a trailing slash does not change which reference resolves', () {
      final uri = Uri.parse('https://$kPreviewDeepLinkHost/preview/abc123/');
      expect(resolvePreviewExchangeReferenceFromUri(uri), 'abc123');
    });
  });

  group('resolvePreviewExchangeReferenceFromString', () {
    test('unparseable input never throws — resolves to null', () {
      expect(resolvePreviewExchangeReferenceFromString('::not a uri at all::'), isNull);
    });

    test('parses a well-formed string the same as its Uri counterpart', () {
      expect(
        resolvePreviewExchangeReferenceFromString('https://$kPreviewDeepLinkHost/preview/abc123'),
        'abc123',
      );
    });
  });
}
