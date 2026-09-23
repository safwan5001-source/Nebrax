import 'package:flutter/material.dart';

import '../actions/action_dispatcher.dart';
import '../schema/schema.dart';
import 'component_registry.dart';

/// Renders one page of an already-[RenderableExperience] (the output of
/// `CompatibilityResolver.resolve()`, MOBILE-RUNTIME-2) through the
/// Component Registry, dispatching interactions through an [AppActionDispatcher].
///
/// This is the minimal glue between the schema/compatibility kernel and the
/// rendering/dispatch registry — it does not manage navigation between
/// pages, does not fetch anything from the Commerce API, and does not
/// implement the ar/en/RTL-LTR shell. Those remain MOBILE-RUNTIME-5/6/7's
/// outcomes; this widget only proves the kernel's output is renderable and
/// interactive end-to-end for a single page.
class ExperienceView extends StatelessWidget {
  final RenderableExperience experience;
  final String pageId;
  final AppActionDispatcher dispatcher;

  const ExperienceView({
    super.key,
    required this.experience,
    required this.pageId,
    required this.dispatcher,
  });

  @override
  Widget build(BuildContext context) {
    final page = experience.pages[pageId];
    if (page == null) {
      // Not a schema/runtime compatibility failure (that is already fully
      // handled before a RenderableExperience exists at all) — this is a
      // caller error (an unknown pageId), so fail closed to a controlled
      // state rather than throw during build.
      return const Center(child: Text('الصفحة غير موجودة'));
    }
    return ComponentView(node: page, onAction: dispatcher.dispatch);
  }
}
