import 'dart:convert';

import 'package:awj_mobile_runtime/preview/preview.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';
import '../schema/test_schemas.dart';

/// Proves [PreviewRuntimeView] actually renders through the real
/// [CompatibilityResolver] + Component Registry + [ExperienceView] pipeline
/// (MOBILE-PREVIEW-6 item 5) — not merely that the pure decision functions
/// in `preview_startup_test.dart` return the right type in isolation.
PreviewClient _client(Future<CommerceHttpResponse> Function(CommerceHttpRequest) handler) {
  return PreviewClient(
    config: PreviewConfig(baseUrl: Uri.parse('https://api.example.com/preview/v1'), sessionToken: 'raw-bearer'),
    transport: FakeCommerceTransport(handler),
  );
}

Widget _app(PreviewClient client) {
  return MaterialApp(home: Scaffold(body: PreviewRuntimeView(client: client)));
}

/// Builds a fake `preview/v1/experience` success response whose `data.schema`
/// is decoded straight from the shared, already-proven-valid
/// `baseSchemaJson`/`componentNode` builders — never a hand-rolled Map
/// literal that could silently drift from the real App Schema shape.
Map<String, Object?> _successBody(String schemaJson, {bool draftChanged = false}) {
  return {
    'data': {
      'schema': jsonDecode(schemaJson),
      'source': 'draft',
      'draft_revision': 1,
      'draft_changed': draftChanged,
    },
    'meta': successMeta(),
  };
}

void main() {
  testWidgets('a compatible snapshot is actually rendered through ExperienceView', (tester) async {
    const marker = 'PREVIEW_MARKER_ABC';
    final schemaJson = encodeSchema(
      baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [componentNode(type: 'Text', id: 'marker', props: {'text': marker})],
        ),
      ),
    );
    final client = _client((request) async => jsonResponse(200, _successBody(schemaJson)));

    await tester.pumpWidget(_app(client));
    await tester.pump();
    await tester.pump();

    expect(find.text(marker), findsOneWidget);
    // لا شريط "تغيّرت المسودة" حين draft_changed = false.
    expect(find.textContaining('تغيّرت المسودة'), findsNothing);
  });

  testWidgets('draft_changed shows the advisory banner without blocking the render', (tester) async {
    final schemaJson = encodeSchema(baseSchemaJson());
    final client = _client(
      (request) async => jsonResponse(200, _successBody(schemaJson, draftChanged: true)),
    );

    await tester.pumpWidget(_app(client));
    await tester.pump();
    await tester.pump();

    expect(find.textContaining('تغيّرت المسودة'), findsOneWidget);
  });

  testWidgets('an unauthorized (expired/revoked/unknown) session shows the generic unavailable state', (tester) async {
    final client = _client(
      (request) async => jsonResponse(401, {
        'error': {'code': 'unauthenticated', 'message': 'x'},
        'meta': successMeta(),
      }),
    );

    await tester.pumpWidget(_app(client));
    await tester.pump();
    await tester.pump();

    expect(find.text('هذه المعاينة لم تعد متاحة.'), findsOneWidget);
  });

  testWidgets('an incompatible snapshot shows the real IncompatibleView, never renders it', (tester) async {
    final schemaJson = encodeSchema(baseSchemaJson(schemaVersion: '9.0.0', minRuntimeVersion: '9.0.0'));
    final client = _client((request) async => jsonResponse(200, _successBody(schemaJson)));

    await tester.pumpWidget(_app(client));
    await tester.pump();
    await tester.pump();

    expect(find.text('هذا الإصدار لا يدعم هذه الشاشة'), findsOneWidget);
  });

  testWidgets('a transport failure shows the retryable unavailable state', (tester) async {
    final client = PreviewClient(
      config: PreviewConfig(baseUrl: Uri.parse('https://api.example.com/preview/v1'), sessionToken: 'raw-bearer'),
      transport: FakeCommerceTransport((request) => Future.error(Exception('no network'))),
    );

    await tester.pumpWidget(_app(client));
    await tester.pump();
    await tester.pump();

    expect(find.byType(ElevatedButton), findsOneWidget); // ErrorRetryView's retry button.
  });
}
