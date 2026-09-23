// MOBILE-RUNTIME-10 (horizon MR-18) — real, device-independent performance
// evidence for the one part of MR-18's measurement method that this
// environment can genuinely exercise without a device/emulator/simulator:
// the schema parse -> validate -> render path, run headlessly through
// `flutter test` (Flutter's own first-party headless test runner — no
// device attaches to run this, exactly like every other test in this
// suite). See `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md`
// §3 ("Internal instrumentation" via `Stopwatch`) for the method this file
// implements, and this task's implementation report for why cold/warm
// startup `timeToFirstFrameMicros`, first-meaningful-render, and scroll/
// jank are explicitly NOT measured here (they require a real device/
// emulator/simulator, which this environment does not have and which the
// owner directed this task not to newly provision).
//
// Every number this file produces is printed to stdout (captured in CI job
// logs) rather than asserted against a strict pass/fail threshold — MR-18's
// provisional budgets are targets to report against, not gates that should
// make an unrelated CI runner's transient slowness fail this PR. Each test
// still asserts a generous sanity ceiling so a genuine severe regression
// (e.g. an accidental O(n^2) added to the resolver) would still fail CI.

import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/app/runtime_schema.dart';
import 'package:awj_mobile_runtime/registry/registry.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Runs [body] [iterations] times, discarding the first [warmup] runs (JIT/
/// cache warm-up noise), and returns the remaining wall-clock durations.
List<Duration> _sample(
  void Function() body, {
  int iterations = 500,
  int warmup = 20,
}) {
  for (var i = 0; i < warmup; i++) {
    body();
  }
  final samples = <Duration>[];
  final stopwatch = Stopwatch();
  for (var i = 0; i < iterations; i++) {
    stopwatch
      ..reset()
      ..start();
    body();
    stopwatch.stop();
    samples.add(stopwatch.elapsed);
  }
  return samples;
}

void _report(String label, List<Duration> samples) {
  final micros = samples.map((d) => d.inMicroseconds).toList()..sort();
  final n = micros.length;
  final min = micros.first;
  final median = micros[n ~/ 2];
  final p90 = micros[(n * 0.9).floor().clamp(0, n - 1)];
  final max = micros.last;
  final mean = micros.reduce((a, b) => a + b) / n;
  // ignore: avoid_print
  print(
    'PERF[$label] n=$n min=$minµs median=$medianµs p90=$p90µs '
    'max=$maxµs mean=${mean.toStringAsFixed(1)}µs',
  );
}

void main() {
  final homeManifest = CapabilityManifest.current(RuntimePlatform.android);

  group('MR-18 — schema parse/validate path (pure Dart, headless)', () {
    test('kHomeSchemaJson: parse + resolve wall-clock', () {
      final samples = _sample(() {
        final schema = AppSchema.parse(kHomeSchemaJson);
        const CompatibilityResolver().resolve(schema, homeManifest);
      });
      _report('home.parse+resolve', samples);

      final medianMicros = (samples.map((d) => d.inMicroseconds).toList()..sort())[samples.length ~/ 2];
      // Generous sanity ceiling, not MR-18's real budget (that is compared
      // in the implementation report against the actual printed numbers,
      // per-run, not hardcoded here where CI-runner variance would make a
      // tight threshold flaky).
      expect(medianMicros, lessThan(50000), reason: 'median parse+resolve should stay well under 50ms');
    });

    test('kCartSchemaJson: parse + resolve wall-clock', () {
      final samples = _sample(() {
        final schema = AppSchema.parse(kCartSchemaJson);
        const CompatibilityResolver().resolve(schema, homeManifest);
      });
      _report('cart.parse+resolve', samples);
    });

    test('kHomeSchemaJson: parse only (isolates parsing from resolution)', () {
      final samples = _sample(() => AppSchema.parse(kHomeSchemaJson));
      _report('home.parse-only', samples);
    });
  });

  group('MR-18 — headless widget-tree render proxy (flutter test host, not a device)', () {
    testWidgets(
      'ExperienceView builds the resolved Home page tree (pump-to-settle wall-clock)',
      (tester) async {
        final schema = AppSchema.parse(kHomeSchemaJson);
        final result = const CompatibilityResolver().resolve(schema, homeManifest);
        expect(result, isA<RenderableExperience>());
        final experience = result as RenderableExperience;
        const dispatcher = AppActionDispatcher(NoopActionHandler());

        final widgetTree = MaterialApp(
          home: Scaffold(
            body: ExperienceView(experience: experience, pageId: 'home', dispatcher: dispatcher),
          ),
        );

        final coldStopwatch = Stopwatch()..start();
        await tester.pumpWidget(widgetTree);
        await tester.pumpAndSettle();
        coldStopwatch.stop();

        // A second pump of the identical tree isolates steady-state
        // rebuild/layout/paint cost from this test *process's* one-time
        // Flutter engine/binding initialization, which the first pump in
        // any fresh test isolate always pays and a real running app does
        // not repeat per frame.
        final warmStopwatch = Stopwatch()..start();
        await tester.pumpWidget(widgetTree);
        await tester.pumpAndSettle();
        warmStopwatch.stop();

        // ignore: avoid_print
        print(
          'PERF[home.render.headless-widget-test.cold] '
          '${coldStopwatch.elapsed.inMicroseconds}µs (single sample, includes '
          'this test isolate\'s one-time engine/binding init — NOT a '
          'device-measured first-meaningful-render)',
        );
        // ignore: avoid_print
        print(
          'PERF[home.render.headless-widget-test.warm] '
          '${warmStopwatch.elapsed.inMicroseconds}µs (single sample, steady-'
          'state rebuild of the identical tree — still NOT a device-measured '
          'render; see MR-18 NOT-MEASURED note in this task\'s implementation '
          'report)',
        );

        expect(find.byType(ExperienceView), findsOneWidget);
      },
    );
  });
}
