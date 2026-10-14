#!/usr/bin/env bash
# Seeds non-production test data through the public API (no direct DB writes for business documents).
# Aborts on the first HTTP error or missing id, so a crawl never runs against a half-seeded tenant.
set -euo pipefail
API=${API:-http://127.0.0.1:8000/api}
T="$1"
h=(-H "Authorization: Bearer $T" -H 'Accept: application/json' -H 'Content-Type: application/json')
post() { curl -sS --fail-with-body "${h[@]}" -X POST "$API/$1" -d "$2"; }
id_of() { local id; id=$(post "$1" "$2" | jq -r '.data.id // .id // empty'); [[ -n "$id" ]] || { echo "seed: no id returned by POST /$1" >&2; exit 1; }; echo "$id"; }

C1=$(id_of partners '{"name":"مؤسسة الطموح للتجارة","type":"customer","vat_number":"310000000000003","city":"الدمام","email":"c1@example.test"}')
C2=$(id_of partners '{"name":"شركة الخليج الشرقي للخدمات اللوجستية والنقل البري والبحري المحدودة","name_en":"Eastern Gulf Logistics & Land and Sea Transport Services Co. Ltd.","type":"customer","city":"الجبيل"}')
C3=$(id_of partners '{"name":"Al Khobar Trading Est.","type":"both","city":"الخبر"}')
for i in $(seq 4 28); do id_of partners "{\"name\":\"عميل اختبار $i\",\"type\":\"customer\",\"city\":\"الأحساء\"}" >/dev/null; done
S1=$(id_of partners '{"name":"مورد المحروقات الوطني","type":"supplier","vat_number":"320000000000003","city":"الظهران"}')
S2=$(id_of partners '{"name":"National Spare Parts Supplier","type":"supplier"}')
P1=$(id_of products '{"name":"ديزل 91 لتر","type":"good","sale_price":215,"unit":"لتر","sku":"FUEL-91"}')
P2=$(id_of products '{"name":"زيت محرك صناعي عالي الأداء لمحركات الديزل الثقيلة 20 لتر","name_en":"Heavy-duty synthetic diesel engine oil 20L","type":"good","sale_price":45000,"sku":"OIL-HD-20"}')
P3=$(id_of products '{"name":"خدمة صيانة دورية","type":"service","sale_price":150000}')
P4=$(id_of products '{"name":"Filter","type":"good","sale_price":2550,"sku":"FLT-1"}')
echo "C1=$C1 C2=$C2 C3=$C3 S1=$S1 S2=$S2 P1=$P1 P2=$P2 P3=$P3 P4=$P4"

B1=$(id_of purchases "{\"partner_id\":\"$S1\",\"items\":[{\"product_id\":\"$P2\",\"quantity\":40,\"unit_price\":30000,\"tax_rate\":15},{\"product_id\":\"$P4\",\"quantity\":100,\"unit_price\":1500,\"tax_rate\":15}]}")
B2=$(id_of purchases "{\"partner_id\":\"$S2\",\"items\":[{\"product_id\":\"$P4\",\"quantity\":10,\"unit_price\":1499,\"tax_rate\":15}]}")
I1=$(id_of invoices "{\"partner_id\":\"$C1\",\"items\":[{\"product_id\":\"$P2\",\"quantity\":3,\"unit_price\":45000,\"tax_rate\":15},{\"product_id\":\"$P3\",\"quantity\":1,\"unit_price\":150000,\"tax_rate\":15}]}")
I2=$(id_of invoices "{\"partner_id\":\"$C2\",\"items\":[{\"product_id\":\"$P4\",\"quantity\":7,\"unit_price\":2550,\"tax_rate\":15}]}")
I3=$(id_of invoices "{\"partner_id\":\"$C3\",\"items\":[{\"product_id\":\"$P3\",\"quantity\":2,\"unit_price\":999999,\"tax_rate\":15}]}")
# Posting goes through the normal services (LedgerService) via the public post endpoints.
post "purchases/$B1/post" '{}' >/dev/null
post "invoices/$I1/post" '{}' >/dev/null
post "invoices/$I2/post" '{}' >/dev/null
PAY=$(id_of payments "{\"partner_id\":\"$C1\",\"amount\":100000,\"direction\":\"received\",\"method\":\"cash\",\"invoice_id\":\"$I1\"}")
echo "B1=$B1 B2=$B2 I1=$I1 I2=$I2 I3=$I3 PAY=$PAY (I3 and B2 stay draft)"
