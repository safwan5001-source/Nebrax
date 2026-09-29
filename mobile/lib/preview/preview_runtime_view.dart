import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../app/runtime_schema.dart' show currentRuntimePlatform;
import '../app/runtime_status_views.dart';
import '../registry/experience_view.dart';
import '../schema/schema.dart';
import 'preview_action_handler.dart';
import 'preview_client.dart';
import 'preview_config.dart';
import 'preview_fetcher.dart';
import 'preview_startup.dart';

/// MOBILE-PREVIEW-6 — the actual Flutter runtime's Real Runtime Preview
/// entry point: a `PreviewSession` credential in, the real
/// [CompatibilityResolver] + Component Registry + [ExperienceView]
/// hydration/render path out.
///
/// Deliberately **not** folded into [AwjRuntimeShell] (the shipped app's own
/// entry point, with its `CommerceClient`, deep links, push, and full Home/
/// Product/Cart shell): that shell is wired end-to-end to live commerce data
/// a `PreviewSession` structurally cannot reach, and threading a preview
/// mode through every one of its subsystems is exactly the "material mobile
/// runtime redesign" the task's Decision Gates rule out. This is instead a
/// separate, additive surface a development/preview build launches into
/// (`main_preview.dart` — never the production entry point), reusing the
/// real rendering kernel without touching the shipped shell at all.
///
/// No last-known-good cache, no fallback to the bundled Default Experience
/// (see [PreviewStartupDecision]'s own doc comment) — a Preview boot either
/// renders the live snapshot or shows one of three honest controlled states.
class PreviewRuntimeView extends StatefulWidget {
  /// Test-only override — production code always uses the default (`null`),
  /// which builds a real [PreviewClient] from [buildRuntimePreviewConfig].
  final PreviewClient? client;

  const PreviewRuntimeView({super.key, this.client});

  @override
  State<PreviewRuntimeView> createState() => _PreviewRuntimeViewState();
}

class _PreviewRuntimeViewState extends State<PreviewRuntimeView> {
  late final PreviewClient _client;
  PreviewStartupDecision? _decision;
  String _pageId = 'home';

  @override
  void initState() {
    super.initState();
    _client = widget.client ?? PreviewClient(config: buildRuntimePreviewConfig());
    _resolve();
  }

  Future<void> _resolve() async {
    final decision = await resolveRealPreviewStartup(
      client: _client,
      manifest: CapabilityManifest.current(currentRuntimePlatform()),
    );
    if (!mounted) return;
    setState(() {
      _decision = decision;
      if (decision is PreviewReady) {
        _pageId = decision.experience.schema.navigation.initialPageId;
      }
    });
  }

  void _showNotice(PreviewActionNotice notice) {
    if (!mounted) return;
    final message = switch (notice) {
      PreviewActionNotice.navigateUnsupported =>
        'هذه الصفحة غير مدعومة على الجهاز الحقيقي بعد.',
      PreviewActionNotice.requiresLiveData =>
        'هذا الإجراء يحتاج بيانات تجارية حيّة وغير متاح في المعاينة.',
    };
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final decision = _decision;
    if (decision == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (decision is PreviewUnauthorized) {
      // §5.15: نفس الشكل العام لمنتهية/مبطَلة/مجهولة — لا تمييز هنا أيضاً.
      return const _PreviewMessageView(
        icon: Icons.lock_outline,
        message: 'هذه المعاينة لم تعد متاحة.',
      );
    }
    if (decision is PreviewIncompatible) {
      return IncompatibleView(message: decision.message);
    }
    if (decision is PreviewUnavailable) {
      return ErrorRetryView(message: decision.message, onRetry: _resolve);
    }

    final ready = decision as PreviewReady;
    final handler = PreviewActionHandler(
      experience: ready.experience,
      onPageChange: (pageId) => setState(() => _pageId = pageId),
      onNotice: _showNotice,
      onRefreshRequested: _resolve,
    );
    final dispatcher = AppActionDispatcher(handler);

    return Column(
      children: [
        if (ready.draftChanged) const _DraftChangedBanner(),
        Expanded(
          child: ExperienceView(experience: ready.experience, pageId: _pageId, dispatcher: dispatcher),
        ),
      ],
    );
  }
}

/// The §5.5 advisory "Draft changed since this preview was generated" state
/// — never blocking, never substituting content, exactly as the fetch
/// contract requires.
class _DraftChangedBanner extends StatelessWidget {
  const _DraftChangedBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Theme.of(context).colorScheme.secondaryContainer,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Text(
        'تغيّرت المسودة منذ إصدار هذه المعاينة — أصدر معاينة جديدة لرؤية آخر التعديلات.',
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.bodySmall,
      ),
    );
  }
}

class _PreviewMessageView extends StatelessWidget {
  final IconData icon;
  final String message;
  const _PreviewMessageView({required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: Theme.of(context).colorScheme.error, size: 40),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
