import 'commerce_error.dart';

/// `docs/openapi/commerce-api-v1.yaml`'s `Money` schema: an integer minor-
/// unit amount (e.g. halalas) plus an ISO-4217 currency. Never a `double` —
/// this runtime does no arithmetic on it at all (CLAUDE.md's global money
/// rule), only display formatting in the registry layer (MOBILE-RUNTIME-3's
/// `formatMinorAmount`).
class CommerceMoney {
  final int amountMinor;
  final String currency;

  const CommerceMoney({required this.amountMinor, required this.currency});

  factory CommerceMoney._fromJson(Map<String, Object?> json) {
    return CommerceMoney(
      amountMinor: _int(json, 'amount_minor'),
      currency: _string(json, 'currency'),
    );
  }
}

class CommercePaginationInfo {
  final int page;
  final int perPage;
  final int total;
  final int lastPage;
  final bool hasMore;

  const CommercePaginationInfo({
    required this.page,
    required this.perPage,
    required this.total,
    required this.lastPage,
    required this.hasMore,
  });

  factory CommercePaginationInfo._fromJson(Map<String, Object?> json) {
    return CommercePaginationInfo(
      page: _int(json, 'page'),
      perPage: _int(json, 'per_page'),
      total: _int(json, 'total'),
      lastPage: _int(json, 'last_page'),
      hasMore: _bool(json, 'has_more'),
    );
  }
}

class CommerceCategoryRef {
  final String id;
  final String name;

  const CommerceCategoryRef({required this.id, required this.name});
}

class CommerceCategory {
  final String id;
  final String name;
  final String? description;
  final String? color;
  final String? parentId;
  final List<CommerceCategory> children;
  final List<CommerceCategoryRef> ancestors;

  const CommerceCategory({
    required this.id,
    required this.name,
    required this.description,
    required this.color,
    required this.parentId,
    required this.children,
    required this.ancestors,
  });

  factory CommerceCategory.fromJson(Map<String, Object?> json) {
    final childrenRaw = json['children'];
    final ancestorsRaw = json['ancestors'];
    return CommerceCategory(
      id: _string(json, 'id'),
      name: _string(json, 'name'),
      description: _nullableString(json, 'description'),
      color: _nullableString(json, 'color'),
      parentId: _nullableString(json, 'parent_id'),
      children: childrenRaw is List
          ? childrenRaw
                .map(
                  (e) => CommerceCategory.fromJson(
                    _map(e, context: 'category.children[]'),
                  ),
                )
                .toList()
          : const [],
      ancestors: ancestorsRaw is List
          ? ancestorsRaw.map((e) {
              final m = _map(e, context: 'category.ancestors[]');
              return CommerceCategoryRef(
                id: _string(m, 'id'),
                name: _string(m, 'name'),
              );
            }).toList()
          : const [],
    );
  }
}

class CommerceProductMedia {
  final String id;
  final String url;
  final String? alt;
  final int? position;

  const CommerceProductMedia({
    required this.id,
    required this.url,
    required this.alt,
    required this.position,
  });

  factory CommerceProductMedia._fromJson(Map<String, Object?> json) {
    return CommerceProductMedia(
      id: _string(json, 'id'),
      url: _string(json, 'url'),
      alt: _nullableString(json, 'alt'),
      position: _nullableInt(json, 'position'),
    );
  }
}

class CommerceProductOptionValue {
  final String id;
  final String value;
  final String? valueEn;

  const CommerceProductOptionValue({
    required this.id,
    required this.value,
    required this.valueEn,
  });
}

class CommerceProductOption {
  final String id;
  final String name;
  final String? nameEn;
  final List<CommerceProductOptionValue> values;

  const CommerceProductOption({
    required this.id,
    required this.name,
    required this.nameEn,
    required this.values,
  });

  factory CommerceProductOption._fromJson(Map<String, Object?> json) {
    final valuesRaw = json['values'];
    return CommerceProductOption(
      id: _string(json, 'id'),
      name: _string(json, 'name'),
      nameEn: _nullableString(json, 'name_en'),
      values: valuesRaw is List
          ? valuesRaw.map((e) {
              final m = _map(e, context: 'product.options[].values[]');
              return CommerceProductOptionValue(
                id: _string(m, 'id'),
                value: _string(m, 'value'),
                valueEn: _nullableString(m, 'value_en'),
              );
            }).toList()
          : const [],
    );
  }
}

class CommerceProductVariant {
  final String id;
  final String? sku;
  final String? descriptor;
  final List<String> optionValueIds;
  final CommerceMoney price;
  final bool? inStock;
  final List<CommerceProductMedia> media;

  const CommerceProductVariant({
    required this.id,
    required this.sku,
    required this.descriptor,
    required this.optionValueIds,
    required this.price,
    required this.inStock,
    required this.media,
  });

  factory CommerceProductVariant._fromJson(Map<String, Object?> json) {
    return CommerceProductVariant(
      id: _string(json, 'id'),
      sku: _nullableString(json, 'sku'),
      descriptor: _nullableString(json, 'descriptor'),
      optionValueIds: _stringList(json, 'option_value_ids'),
      price: CommerceMoney._fromJson(
        _map(json['price'], context: 'variant.price'),
      ),
      inStock: _nullableBool(json, 'in_stock'),
      media: _mediaList(json, 'media'),
    );
  }
}

/// A `/products` list row. Never carries `media`/`options`/`variants` — the
/// list endpoint intentionally omits them (`docs/openapi/commerce-api-v1.yaml`
/// on `GET /products`).
class CommerceProductSummary {
  final String id;
  final String name;
  final String? nameEn;
  final String? description;
  final String? sku;
  final CommerceCategoryRef? category;
  final CommerceMoney price;
  final bool? inStock;
  final String? thumbnailUrl;
  final bool isVariantManaged;

  const CommerceProductSummary({
    required this.id,
    required this.name,
    required this.nameEn,
    required this.description,
    required this.sku,
    required this.category,
    required this.price,
    required this.inStock,
    required this.thumbnailUrl,
    required this.isVariantManaged,
  });

  factory CommerceProductSummary.fromJson(Map<String, Object?> json) {
    return CommerceProductSummary(
      id: _string(json, 'id'),
      name: _string(json, 'name'),
      nameEn: _nullableString(json, 'name_en'),
      description: _nullableString(json, 'description'),
      sku: _nullableString(json, 'sku'),
      category: _categoryRef(json['category']),
      price: CommerceMoney._fromJson(
        _map(json['price'], context: 'product.price'),
      ),
      inStock: _nullableBool(json, 'in_stock'),
      thumbnailUrl: _nullableString(json, 'thumbnail_url'),
      isVariantManaged: _bool(json, 'is_variant_managed'),
    );
  }
}

/// `GET /products/{id}`'s `oneOf` response, discriminated by
/// `is_variant_managed` — a simple product ([CommerceSimpleProduct]) never
/// carries `options`/`variants`; a variant-managed one
/// ([CommerceVariantManagedProduct]) always does.
sealed class CommerceProductDetail {
  final String id;
  final String name;
  final String? nameEn;
  final String? description;
  final String? sku;
  final CommerceCategoryRef? category;
  final CommerceMoney price;
  final bool? inStock;
  final String? thumbnailUrl;
  final List<CommerceProductMedia> media;

  const CommerceProductDetail({
    required this.id,
    required this.name,
    required this.nameEn,
    required this.description,
    required this.sku,
    required this.category,
    required this.price,
    required this.inStock,
    required this.thumbnailUrl,
    required this.media,
  });

  factory CommerceProductDetail.fromJson(Map<String, Object?> json) {
    final isVariantManaged = _bool(json, 'is_variant_managed');
    final shared = (
      id: _string(json, 'id'),
      name: _string(json, 'name'),
      nameEn: _nullableString(json, 'name_en'),
      description: _nullableString(json, 'description'),
      sku: _nullableString(json, 'sku'),
      category: _categoryRef(json['category']),
      price: CommerceMoney._fromJson(
        _map(json['price'], context: 'product.price'),
      ),
      inStock: _nullableBool(json, 'in_stock'),
      thumbnailUrl: _nullableString(json, 'thumbnail_url'),
      media: _mediaList(json, 'media'),
    );
    if (!isVariantManaged) {
      return CommerceSimpleProduct(
        id: shared.id,
        name: shared.name,
        nameEn: shared.nameEn,
        description: shared.description,
        sku: shared.sku,
        category: shared.category,
        price: shared.price,
        inStock: shared.inStock,
        thumbnailUrl: shared.thumbnailUrl,
        media: shared.media,
      );
    }
    final optionsRaw = json['options'];
    final variantsRaw = json['variants'];
    return CommerceVariantManagedProduct(
      id: shared.id,
      name: shared.name,
      nameEn: shared.nameEn,
      description: shared.description,
      sku: shared.sku,
      category: shared.category,
      price: shared.price,
      inStock: shared.inStock,
      thumbnailUrl: shared.thumbnailUrl,
      media: shared.media,
      options: optionsRaw is List
          ? optionsRaw
                .map(
                  (e) => CommerceProductOption._fromJson(
                    _map(e, context: 'product.options[]'),
                  ),
                )
                .toList()
          : const [],
      variants: variantsRaw is List
          ? variantsRaw
                .map(
                  (e) => CommerceProductVariant._fromJson(
                    _map(e, context: 'product.variants[]'),
                  ),
                )
                .toList()
          : const [],
    );
  }
}

final class CommerceSimpleProduct extends CommerceProductDetail {
  const CommerceSimpleProduct({
    required super.id,
    required super.name,
    required super.nameEn,
    required super.description,
    required super.sku,
    required super.category,
    required super.price,
    required super.inStock,
    required super.thumbnailUrl,
    required super.media,
  });
}

final class CommerceVariantManagedProduct extends CommerceProductDetail {
  final List<CommerceProductOption> options;
  final List<CommerceProductVariant> variants;

  const CommerceVariantManagedProduct({
    required super.id,
    required super.name,
    required super.nameEn,
    required super.description,
    required super.sku,
    required super.category,
    required super.price,
    required super.inStock,
    required super.thumbnailUrl,
    required super.media,
    required this.options,
    required this.variants,
  });
}

class CommerceProductPage {
  final List<CommerceProductSummary> items;
  final CommercePaginationInfo pagination;

  const CommerceProductPage({required this.items, required this.pagination});
}

class CommerceCartItem {
  final String id;
  final String? productId;
  final String? productVariantId;
  final String? variantDescriptor;
  final String productName;
  final String unitKey;
  final String? unitName;
  final int quantity;
  final CommerceMoney unitPrice;
  final CommerceMoney lineTotal;
  final bool available;

  const CommerceCartItem({
    required this.id,
    required this.productId,
    required this.productVariantId,
    required this.variantDescriptor,
    required this.productName,
    required this.unitKey,
    required this.unitName,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
    required this.available,
  });

  factory CommerceCartItem._fromJson(Map<String, Object?> json) {
    return CommerceCartItem(
      id: _string(json, 'id'),
      productId: _nullableString(json, 'product_id'),
      productVariantId: _nullableString(json, 'product_variant_id'),
      variantDescriptor: _nullableString(json, 'variant_descriptor'),
      productName: _string(json, 'product_name'),
      unitKey: _string(json, 'unit_key'),
      unitName: _nullableString(json, 'unit_name'),
      quantity: _int(json, 'quantity'),
      unitPrice: CommerceMoney._fromJson(
        _map(json['unit_price'], context: 'cart_item.unit_price'),
      ),
      lineTotal: CommerceMoney._fromJson(
        _map(json['line_total'], context: 'cart_item.line_total'),
      ),
      available: _bool(json, 'available'),
    );
  }
}

class CommerceCart {
  final String? status;
  final List<CommerceCartItem> items;
  final CommerceMoney subtotal;
  final String currency;
  final bool hasUnavailableItems;

  const CommerceCart({
    required this.status,
    required this.items,
    required this.subtotal,
    required this.currency,
    required this.hasUnavailableItems,
  });

  factory CommerceCart.fromJson(Map<String, Object?> json) {
    final itemsRaw = json['items'];
    return CommerceCart(
      status: _nullableString(json, 'status'),
      items: itemsRaw is List
          ? itemsRaw
                .map(
                  (e) => CommerceCartItem._fromJson(
                    _map(e, context: 'cart.items[]'),
                  ),
                )
                .toList()
          : const [],
      subtotal: CommerceMoney._fromJson(
        _map(json['subtotal'], context: 'cart.subtotal'),
      ),
      currency: _string(json, 'currency'),
      hasUnavailableItems: _bool(json, 'has_unavailable_items'),
    );
  }
}

class CommerceCustomerIdentity {
  final String id;
  final String? displayName;
  final String? email;
  final String? phone;
  final bool emailVerified;
  final bool phoneVerified;
  final bool isActive;

  const CommerceCustomerIdentity({
    required this.id,
    required this.displayName,
    required this.email,
    required this.phone,
    required this.emailVerified,
    required this.phoneVerified,
    required this.isActive,
  });

  factory CommerceCustomerIdentity._fromJson(Map<String, Object?> json) {
    return CommerceCustomerIdentity(
      id: _string(json, 'id'),
      displayName: _nullableString(json, 'display_name'),
      email: _nullableString(json, 'email'),
      phone: _nullableString(json, 'phone'),
      emailVerified: _bool(json, 'email_verified'),
      phoneVerified: _bool(json, 'phone_verified'),
      isActive: _bool(json, 'is_active'),
    );
  }
}

/// The outcome of a successful `auth/login` or `auth/otp/verify` call
/// (`TokenAuthResponse`). [token] must reach [SecureSessionStore] and
/// nowhere else — [CommerceClient] enforces this by never returning it to
/// its own caller (see `commerce_client.dart`).
class CommerceAuthResult {
  final String token;
  final CommerceCustomerIdentity customer;

  const CommerceAuthResult._({required this.token, required this.customer});

  factory CommerceAuthResult._fromJson(Map<String, Object?> json) {
    return CommerceAuthResult._(
      token: _string(json, 'token'),
      customer: CommerceCustomerIdentity._fromJson(
        _map(json['customer'], context: 'auth.customer'),
      ),
    );
  }
}

class CommercePartnerLink {
  final bool linked;
  final String? partnerId;

  const CommercePartnerLink({required this.linked, required this.partnerId});
}

class CommerceMeProfile {
  final CommerceCustomerIdentity customer;
  final CommercePartnerLink partnerLink;

  const CommerceMeProfile({required this.customer, required this.partnerLink});

  factory CommerceMeProfile._fromJson(Map<String, Object?> json) {
    final linkRaw = _map(json['partner_link'], context: 'me.partner_link');
    return CommerceMeProfile(
      customer: CommerceCustomerIdentity._fromJson(
        _map(json['customer'], context: 'me.customer'),
      ),
      partnerLink: CommercePartnerLink(
        linked: _bool(linkRaw, 'linked'),
        partnerId: _nullableString(linkRaw, 'partner_id'),
      ),
    );
  }
}

class CommerceStorefront {
  final String? name;

  const CommerceStorefront({required this.name});

  factory CommerceStorefront._fromJson(Map<String, Object?> json) {
    return CommerceStorefront(name: _nullableString(json, 'name'));
  }
}

// -- Envelope-unwrapping factories (`{ "data": …, "meta": … }`) --------------

CommerceStorefront parseStorefrontResponse(Map<String, Object?> envelope) =>
    CommerceStorefront._fromJson(
      _map(envelope['data'], context: 'storefront.data'),
    );

List<CommerceCategory> parseCategoryListResponse(
  Map<String, Object?> envelope,
) {
  final data = envelope['data'];
  if (data is! List) {
    throw const CommerceProtocolException('categories.data must be a list');
  }
  return data
      .map(
        (e) => CommerceCategory.fromJson(_map(e, context: 'categories.data[]')),
      )
      .toList();
}

CommerceCategory parseCategoryResponse(Map<String, Object?> envelope) =>
    CommerceCategory.fromJson(_map(envelope['data'], context: 'category.data'));

CommerceProductPage parseProductListResponse(Map<String, Object?> envelope) {
  final data = envelope['data'];
  if (data is! List) {
    throw const CommerceProtocolException('products.data must be a list');
  }
  final meta = _map(envelope['meta'], context: 'products.meta');
  final paginationRaw = _map(
    meta['pagination'],
    context: 'products.meta.pagination',
  );
  return CommerceProductPage(
    items: data
        .map(
          (e) => CommerceProductSummary.fromJson(
            _map(e, context: 'products.data[]'),
          ),
        )
        .toList(),
    pagination: CommercePaginationInfo._fromJson(paginationRaw),
  );
}

CommerceProductDetail parseProductDetailResponse(
  Map<String, Object?> envelope,
) => CommerceProductDetail.fromJson(
  _map(envelope['data'], context: 'product.data'),
);

CommerceCart parseCartResponse(Map<String, Object?> envelope) =>
    CommerceCart.fromJson(_map(envelope['data'], context: 'cart.data'));

bool parseRegisterResponse(Map<String, Object?> envelope) => _bool(
  _map(envelope['data'], context: 'register.data'),
  'verification_required',
);

bool parseOtpRequestResponse(Map<String, Object?> envelope) =>
    _bool(_map(envelope['data'], context: 'otp_request.data'), 'sent');

CommerceAuthResult parseTokenAuthResponse(Map<String, Object?> envelope) =>
    CommerceAuthResult._fromJson(_map(envelope['data'], context: 'auth.data'));

bool parseLogoutResponse(Map<String, Object?> envelope) =>
    _bool(_map(envelope['data'], context: 'logout.data'), 'logged_out');

CommerceMeProfile parseMeResponse(Map<String, Object?> envelope) =>
    CommerceMeProfile._fromJson(_map(envelope['data'], context: 'me.data'));

// -- Defensive scalar/collection extraction ---------------------------------
//
// Unlike `app_schema.dart`'s strict allowlist parsing (untrusted, potentially
// adversarial CMS-authored input), these read a *trusted first-party
// server's* own documented contract: unknown/additional fields are ignored
// for forward compatibility, but every documented field is still type- and
// presence-checked, and any mismatch raises `CommerceProtocolException`
// rather than a raw `TypeError`/`NoSuchMethodError` escaping this layer.

Map<String, Object?> _map(Object? value, {required String context}) {
  if (value is Map) return value.cast<String, Object?>();
  throw CommerceProtocolException('$context must be an object');
}

CommerceCategoryRef? _categoryRef(Object? value) {
  if (value == null) return null;
  final m = _map(value, context: 'category');
  return CommerceCategoryRef(id: _string(m, 'id'), name: _string(m, 'name'));
}

List<CommerceProductMedia> _mediaList(Map<String, Object?> json, String key) {
  final raw = json[key];
  if (raw is! List) return const [];
  return raw
      .map((e) => CommerceProductMedia._fromJson(_map(e, context: '$key[]')))
      .toList();
}

String _string(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw CommerceProtocolException('"$key" must be a string');
}

String? _nullableString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is String) return value;
  throw CommerceProtocolException('"$key" must be a string or null');
}

int _int(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is int) return value;
  throw CommerceProtocolException('"$key" must be an integer');
}

int? _nullableInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is int) return value;
  throw CommerceProtocolException('"$key" must be an integer or null');
}

bool _bool(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is bool) return value;
  throw CommerceProtocolException('"$key" must be a boolean');
}

bool? _nullableBool(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is bool) return value;
  throw CommerceProtocolException('"$key" must be a boolean or null');
}

List<String> _stringList(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! List) return const [];
  return value.map((e) {
    if (e is String) return e;
    throw CommerceProtocolException('"$key" entries must be strings');
  }).toList();
}
