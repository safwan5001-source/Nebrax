import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/registry/registry.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../actions/recording_action_handler.dart';

SchemaComponent node({
  required String type,
  String id = 'n',
  bool optional = false,
  Map<String, Object?> props = const {},
  List<SchemaComponent> children = const [],
  ActionRef? action,
}) {
  return SchemaComponent(
    type: type,
    id: id,
    optional: optional,
    props: props,
    children: children,
    action: action,
  );
}

Future<void> pumpComponent(WidgetTester tester, SchemaComponent node, ActionDispatch onAction) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: ComponentView(node: node, onAction: onAction)),
    ),
  );
}

void main() {
  test('ComponentRegistry.builders covers exactly RuntimeCapabilities.components', () {
    expect(
      ComponentRegistry.builders.keys.toSet(),
      RuntimeCapabilities.components.keys.toSet(),
      reason: 'the rendering registry must implement exactly the identifiers the '
          'capability manifest claims to support — never more, never fewer',
    );
  });

  testWidgets('an unrecognized component type renders nothing, never throws', (tester) async {
    await pumpComponent(tester, node(type: 'SomeFutureWidget'), (_) async {});
    expect(tester.takeException(), isNull);
  });

  testWidgets('Page renders its children in a scrollable list', (tester) async {
    await pumpComponent(
      tester,
      node(type: 'Page', children: [
        node(type: 'Text', id: 't1', props: {'text': 'أَوْج'}),
      ]),
      (_) async {},
    );
    expect(find.text('أَوْج'), findsOneWidget);
    expect(find.byType(ListView), findsOneWidget);
  });

  testWidgets('Section renders an optional title then its children', (tester) async {
    await pumpComponent(
      tester,
      node(type: 'Section', props: {'title': 'عنوان القسم'}, children: [
        node(type: 'Text', id: 't1', props: {'text': 'محتوى'}),
      ]),
      (_) async {},
    );
    expect(find.text('عنوان القسم'), findsOneWidget);
    expect(find.text('محتوى'), findsOneWidget);
  });

  testWidgets('Text falls back to an empty string when the text prop is missing', (tester) async {
    await pumpComponent(tester, node(type: 'Text'), (_) async {});
    expect(tester.takeException(), isNull);
  });

  testWidgets('Image with a non-https url renders the safe placeholder, not a network request', (tester) async {
    await pumpComponent(
      tester,
      node(type: 'Image', props: {'url': 'http://insecure.example/x.png'}),
      (_) async {},
    );
    expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
  });

  testWidgets('Price formats minor-unit amounts', (tester) async {
    await pumpComponent(tester, node(type: 'Price', props: {'amountMinor': 12345}), (_) async {});
    expect(find.textContaining('123.45'), findsOneWidget);
  });

  testWidgets('Button with no action renders disabled (inert), never silently succeeds', (tester) async {
    final handler = RecordingActionHandler();
    await pumpComponent(
      tester,
      node(type: 'Button', props: {'label': 'إرسال'}),
      AppActionDispatcher(handler).dispatch,
    );
    final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('Button with an action dispatches it on tap', (tester) async {
    final handler = RecordingActionHandler();
    await pumpComponent(
      tester,
      node(
        type: 'Button',
        props: {'label': 'حدّث'},
        action: const ActionRef(type: 'refresh', params: {}),
      ),
      AppActionDispatcher(handler).dispatch,
    );

    await tester.tap(find.byType(ElevatedButton));
    await tester.pumpAndSettle();

    expect(handler.received, hasLength(1));
    expect(handler.received.single, isA<RefreshAction>());
  });

  testWidgets('AddToCart dispatches addToCart with the schema-declared productId', (tester) async {
    final handler = RecordingActionHandler();
    await pumpComponent(
      tester,
      node(
        type: 'AddToCart',
        action: const ActionRef(type: 'addToCart', params: {'productId': 'p-1'}),
      ),
      AppActionDispatcher(handler).dispatch,
    );

    await tester.tap(find.byType(ElevatedButton));
    await tester.pumpAndSettle();

    final action = handler.received.single as AddToCartAction;
    expect(action.productId, 'p-1');
  });

  testWidgets('NavigationTarget dispatches its navigate action on tap', (tester) async {
    final handler = RecordingActionHandler();
    await pumpComponent(
      tester,
      node(
        type: 'NavigationTarget',
        props: {'label': 'الذهاب للسلة'},
        action: const ActionRef(type: 'navigate', params: {'pageId': 'cart'}),
      ),
      AppActionDispatcher(handler).dispatch,
    );

    await tester.tap(find.text('الذهاب للسلة'));
    await tester.pumpAndSettle();

    final action = handler.received.single as NavigateAction;
    expect(action.pageId, 'cart');
  });

  testWidgets('Quantity stepper clamps to min/max and dispatches updateCartQuantity with the live value',
      (tester) async {
    final handler = RecordingActionHandler();
    await pumpComponent(
      tester,
      node(
        type: 'Quantity',
        props: {'value': 1, 'min': 1, 'max': 2},
        action: const ActionRef(
          type: 'updateCartQuantity',
          params: {'cartItemId': 'ci-1', 'quantity': 1},
        ),
      ),
      AppActionDispatcher(handler).dispatch,
    );

    expect(find.text('1'), findsOneWidget);

    final incrementButton = find.byKey(const ValueKey('quantity-increment'));
    await tester.tap(incrementButton);
    await tester.pumpAndSettle();
    expect(find.text('2'), findsOneWidget);
    expect((handler.received.single as UpdateCartQuantityAction).quantity, 2);

    // Already at max — the + button must now be disabled, not dispatch again.
    final plusButton = tester.widget<IconButton>(incrementButton);
    expect(plusButton.onPressed, isNull);
  });

  testWidgets('VariantSelector selection is local UI state — it never dispatches an action itself',
      (tester) async {
    final handler = RecordingActionHandler();
    await pumpComponent(
      tester,
      node(type: 'VariantSelector', props: {'options': ['أحمر', 'أزرق']}),
      AppActionDispatcher(handler).dispatch,
    );

    await tester.tap(find.text('أزرق'));
    await tester.pumpAndSettle();

    expect(handler.received, isEmpty);
  });

  testWidgets('ProductList renders each child in a bounded horizontal scroller', (tester) async {
    await pumpComponent(
      tester,
      node(type: 'ProductList', children: [
        node(type: 'ProductCard', id: 'p1', props: {'title': 'منتج ١', 'amountMinor': 1000}),
        node(type: 'ProductCard', id: 'p2', props: {'title': 'منتج ٢', 'amountMinor': 2000}),
      ]),
      (_) async {},
    );
    expect(find.text('منتج ١'), findsOneWidget);
    expect(find.text('منتج ٢'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('ExperienceView renders the requested page and routes taps through the dispatcher',
      (tester) async {
    final handler = RecordingActionHandler();
    const resolver = CompatibilityResolver();
    final schemaJson = '''
    {
      "schemaVersion": "1.0.0",
      "minRuntimeVersion": "1.0.0",
      "navigation": {"initialPageId": "home"},
      "pages": {
        "home": {
          "type": "Page",
          "id": "home-root",
          "children": [
            {"type": "Button", "id": "go", "props": {"label": "التالي"},
             "action": {"type": "refresh", "params": {}}}
          ]
        }
      }
    }
    ''';
    final schema = AppSchema.parse(schemaJson);
    final result = resolver.resolve(schema, CapabilityManifest.current(RuntimePlatform.ios));
    final experience = result as RenderableExperience;

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ExperienceView(
          experience: experience,
          pageId: 'home',
          dispatcher: AppActionDispatcher(handler),
        ),
      ),
    ));

    await tester.tap(find.text('التالي'));
    await tester.pumpAndSettle();

    expect(handler.received.single, isA<RefreshAction>());
  });

  testWidgets('ExperienceView shows a controlled state for an unknown pageId, never throws',
      (tester) async {
    const resolver = CompatibilityResolver();
    final schema = AppSchema.parse('''
    {
      "schemaVersion": "1.0.0",
      "minRuntimeVersion": "1.0.0",
      "navigation": {"initialPageId": "home"},
      "pages": {"home": {"type": "Page", "id": "home-root"}}
    }
    ''');
    final result = resolver.resolve(schema, CapabilityManifest.current(RuntimePlatform.ios));
    final experience = result as RenderableExperience;

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ExperienceView(
          experience: experience,
          pageId: 'does-not-exist',
          dispatcher: AppActionDispatcher(const NoopActionHandler()),
        ),
      ),
    ));

    expect(tester.takeException(), isNull);
    expect(find.text('الصفحة غير موجودة'), findsOneWidget);
  });
}
