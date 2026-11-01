import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import '../registry/registry.dart';
import '../schema/schema.dart';
import 'binding_resolution.dart';
import 'page_bindings.dart';
import 'runtime_state.dart';
import 'runtime_status_views.dart';
import 'runtime_strings.dart';

/// S06a (PAG-01) — the generic screen for any page the live Experience
/// declares besides `home`/`cart`. It renders the published page node through
/// the same pipeline Home uses (binding resolution -> `ComponentView` ->
/// `AppActionDispatcher`), with loading, error+retry and refresh handled here.
/// It never invents data: a page without bindings renders its literal tree.
class PageScreen extends StatefulWidget {
  final String pageId;
  final RenderableExperience experience;
  final CommerceClient client;
  final RuntimeState state;
  final AppActionDispatcher dispatcher;
  final Locale locale;

  const PageScreen({
    super.key,
    required this.pageId,
    required this.experience,
    required this.client,
    required this.state,
    required this.dispatcher,
    required this.locale,
  });

  @override
  State<PageScreen> createState() => _PageScreenState();
}

class _PageScreenState extends State<PageScreen> {
  Map<String, Object?>? _data;
  String? _errorMessage;
  bool _loading = true;
  int _lastRefresh = 0;
  int _lastCart = 0;

  SchemaComponent? get _page => widget.experience.pages[widget.pageId];

  @override
  void initState() {
    super.initState();
    _lastRefresh = widget.state.refreshVersion;
    _lastCart = widget.state.cartVersion;
    widget.state.addListener(_onStateChanged);
    _load();
  }

  @override
  void didUpdateWidget(covariant PageScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.pageId != widget.pageId || oldWidget.experience != widget.experience) {
      _load();
    }
  }

  @override
  void dispose() {
    widget.state.removeListener(_onStateChanged);
    super.dispose();
  }

  void _onStateChanged() {
    final changed = widget.state.refreshVersion != _lastRefresh || widget.state.cartVersion != _lastCart;
    _lastRefresh = widget.state.refreshVersion;
    _lastCart = widget.state.cartVersion;
    if (changed) _load();
  }

  Future<void> _load() async {
    final page = _page;
    if (page == null) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final data = await fetchPageBindingData(widget.client, page);
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } on CommerceApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.message;
        _loading = false;
      });
    } on CommerceProtocolException catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = RuntimeStrings.of(widget.locale).connectionError;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = RuntimeStrings.of(widget.locale);
    final page = _page;
    if (page == null) return Center(child: Text(strings.pageLoadError));
    if (_loading && _data == null) return const Center(child: CircularProgressIndicator());
    if (_errorMessage != null && _data == null) {
      return ErrorRetryView(message: _errorMessage!, onRetry: _load);
    }

    final data = <String, Object?>{
      for (final entry in (_data ?? const <String, Object?>{}).entries)
        entry.key: entry.value is List ? localizeProductItems(entry.value as List<Object?>, widget.locale) : entry.value,
    };
    final resolved = resolveNodeBindings(page, data);
    return ComponentView(node: resolved, onAction: widget.dispatcher.dispatch);
  }
}
