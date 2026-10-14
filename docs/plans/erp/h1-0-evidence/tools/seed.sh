#!/usr/bin/env bash
# Seeds non-production test data through the public API (no direct DB writes for business docs).
set -u
API=http://127.0.0.1:8000/api
T="$1"
h=(-H "Authorization: Bearer $T" -H 'Accept: application/json' -H 'Content-Type: application/json')
post(){ curl -s "${h[@]}" -X POST "$API/$1" -d "$2"; }
ids=()
C1=$(post partners '{"name":"مؤسسة الطموح للتجارة","type":"customer","vat_number":"310000000000003","city":"الدمام","email":"c1@example.test"}' | jq -r '.data.id // .id')
C2=$(post partners '{"name":"شركة الخليج الشرقي للخدمات اللوجستية والنقل البري والبحري المحدودة","name_en":"Eastern Gulf Logistics & Land and Sea Transport Services Co. Ltd.","type":"customer","city":"الجبيل"}' | jq -r '.data.id // .id')
C3=$(post partners '{"name":"Al Khobar Trading Est.","type":"both","city":"الخبر"}' | jq -r '.data.id // .id')
for i in 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28; do post partners "{\"name\":\"عميل اختبار $i\",\"type\":\"customer\",\"city\":\"الأحساء\"}" >/dev/null; done
S1=$(post partners '{"name":"مورد المحروقات الوطني","type":"supplier","vat_number":"320000000000003","city":"الظهران"}' | jq -r '.data.id // .id')
S2=$(post partners '{"name":"National Spare Parts Supplier","type":"supplier"}' | jq -r '.data.id // .id')
P1=$(post products '{"name":"ديزل 91 لتر","type":"good","sale_price":215,"unit":"لتر","sku":"FUEL-91"}' | jq -r '.data.id // .id')
P2=$(post products '{"name":"زيت محرك صناعي عالي الأداء لمحركات الديزل الثقيلة 20 لتر","name_en":"Heavy-duty synthetic diesel engine oil 20L","type":"good","sale_price":45000,"sku":"OIL-HD-20"}' | jq -r '.data.id // .id')
P3=$(post products '{"name":"خدمة صيانة دورية","type":"service","sale_price":150000}' | jq -r '.data.id // .id')
P4=$(post products '{"name":"Filter","type":"good","sale_price":2550,"sku":"FLT-1"}' | jq -r '.data.id // .id')
echo "C1=$C1 C2=$C2 C3=$C3 S1=$S1 S2=$S2 P1=$P1 P2=$P2 P3=$P3 P4=$P4"
echo "--- purchase"
post purchases "{\"partner_id\":\"$S1\",\"items\":[{\"product_id\":\"$P2\",\"quantity\":40,\"unit_price\":30000,\"tax_rate\":15},{\"product_id\":\"$P4\",\"quantity\":100,\"unit_price\":1500,\"tax_rate\":15}]}" | jq -c '{id:(.data.id//.id), number:(.data.number//.number), status:(.data.status//.status), msg:.message}'
post purchases "{\"partner_id\":\"$S2\",\"items\":[{\"product_id\":\"$P4\",\"quantity\":10,\"unit_price\":1499,\"tax_rate\":15}]}" | jq -c '{id:(.data.id//.id), status:(.data.status//.status), msg:.message}'
echo "--- invoices"
post invoices "{\"partner_id\":\"$C1\",\"items\":[{\"product_id\":\"$P2\",\"quantity\":3,\"unit_price\":45000,\"tax_rate\":15},{\"product_id\":\"$P3\",\"quantity\":1,\"unit_price\":150000,\"tax_rate\":15}]}" | jq -c '{id:(.data.id//.id), number:(.data.number//.number), status:(.data.status//.status), msg:.message, errors:.errors}'
post invoices "{\"partner_id\":\"$C2\",\"items\":[{\"product_id\":\"$P4\",\"quantity\":7,\"unit_price\":2550,\"tax_rate\":15}]}" | jq -c '{id:(.data.id//.id), status:(.data.status//.status), msg:.message}'
post invoices "{\"partner_id\":\"$C3\",\"items\":[{\"product_id\":\"$P3\",\"quantity\":2,\"unit_price\":999999,\"tax_rate\":15}]}" | jq -c '{id:(.data.id//.id), status:(.data.status//.status), msg:.message}'
