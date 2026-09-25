/// Field-shape types a resource field can be declared as — mirrors
/// `App\Services\AppBuilder\ResourceFieldType` (PHP), narrowed to exactly
/// the values `CompatibilityResolver`'s `binding.collect`-target validation
/// needs (`APP-BUILDER-17` slice 3, Decision Gate approved): whether a
/// field is `list`-typed or not. PHP's full enum also names id/string/
/// nullableBoolean/integer/money/object/timestamp — kept here too, for
/// literal parity, but nothing on this runtime distinguishes them beyond
/// `list` yet; this is descriptive metadata only, exactly like
/// `ResourceFieldType` (PHP) itself.
class ResourceFieldType {
  const ResourceFieldType._();

  static const id = 'id';
  static const string = 'string';
  static const nullableBoolean = 'nullableBoolean';
  static const integer = 'integer';
  static const money = 'money';
  static const object = 'object';
  static const list = 'list';
  static const timestamp = 'timestamp';
}

/// One readable field on a [ResourceDefinition] — mirrors
/// `App\Services\AppBuilder\ResourceFieldDefinition` (PHP), narrowed to
/// `key`/`type` only (no `localized`/`notes`): those describe the App
/// Builder Inspector's editing experience, which has no equivalent on this
/// runtime.
class ResourceFieldDefinition {
  final String key;
  final String type;

  const ResourceFieldDefinition(this.key, this.type);
}

/// The full field shape of one bindable `commerce/v1` resource — mirrors
/// `App\Services\AppBuilder\ResourceDefinition` (PHP), narrowed to exactly
/// what `CompatibilityResolver`'s `binding.collect` validation needs
/// (`readableFieldKeys()`/`fieldType()`). PHP's fuller structural check
/// (`itemProps`/`query` key validity against this same registry) stays the
/// documented, deliberate slice-2 deferral — it needs `ComponentRegistry`
/// (props, `bindableResources`) too, which this file does not add; porting
/// it is separate follow-up work, not required for `collect`'s own
/// fail-closed validation.
class ResourceDefinition {
  final String id;
  final int version;
  final List<ResourceFieldDefinition> fields;

  const ResourceDefinition({required this.id, required this.version, required this.fields});

  List<String> readableFieldKeys() => [for (final field in fields) field.key];

  /// The declared type of [key], or `null` if [key] is not a field this
  /// resource declares at all.
  String? fieldType(String key) {
    for (final field in fields) {
      if (field.key == key) return field.type;
    }
    return null;
  }
}

/// `commerce/v1` data-resource field shapes — mirrors
/// `App\Services\AppBuilder\DataResourceRegistry::definitions()` (PHP)
/// literally for the fields it declares (`readableFieldKeys()`, this file's
/// own reason for existing). **Locked to ADR-01's V1 three-resource scope**
/// (`commerce.categories`/`commerce.products`/`commerce.cart`) — the same
/// scope lock as the PHP registry; adding a resource here without adding it
/// there first (or vice versa) breaks the "same schema, same decision on
/// both sides" invariant this whole horizon depends on.
class DataResourceRegistry {
  const DataResourceRegistry._();

  static const Map<String, ResourceDefinition> definitions = {
    'commerce.categories': ResourceDefinition(
      id: 'commerce.categories',
      version: 1,
      fields: [
        ResourceFieldDefinition('id', ResourceFieldType.id),
        ResourceFieldDefinition('name', ResourceFieldType.string),
        ResourceFieldDefinition('description', ResourceFieldType.string),
        ResourceFieldDefinition('color', ResourceFieldType.string),
        ResourceFieldDefinition('parent_id', ResourceFieldType.id),
      ],
    ),
    'commerce.products': ResourceDefinition(
      id: 'commerce.products',
      version: 1,
      fields: [
        ResourceFieldDefinition('id', ResourceFieldType.id),
        ResourceFieldDefinition('name', ResourceFieldType.string),
        ResourceFieldDefinition('description', ResourceFieldType.string),
        ResourceFieldDefinition('sku', ResourceFieldType.string),
        ResourceFieldDefinition('category', ResourceFieldType.object),
        ResourceFieldDefinition('price', ResourceFieldType.money),
        ResourceFieldDefinition('in_stock', ResourceFieldType.nullableBoolean),
        ResourceFieldDefinition('thumbnail_url', ResourceFieldType.string),
        ResourceFieldDefinition('media', ResourceFieldType.list),
        ResourceFieldDefinition('is_variant_managed', ResourceFieldType.nullableBoolean),
        ResourceFieldDefinition('options', ResourceFieldType.list),
        ResourceFieldDefinition('variants', ResourceFieldType.list),
        ResourceFieldDefinition('created_at', ResourceFieldType.timestamp),
        ResourceFieldDefinition('updated_at', ResourceFieldType.timestamp),
      ],
    ),
    'commerce.cart': ResourceDefinition(
      id: 'commerce.cart',
      version: 1,
      fields: [
        ResourceFieldDefinition('status', ResourceFieldType.string),
        ResourceFieldDefinition('items', ResourceFieldType.list),
        ResourceFieldDefinition('subtotal', ResourceFieldType.money),
        ResourceFieldDefinition('currency', ResourceFieldType.string),
        ResourceFieldDefinition('has_unavailable_items', ResourceFieldType.nullableBoolean),
      ],
    ),
  };
}
