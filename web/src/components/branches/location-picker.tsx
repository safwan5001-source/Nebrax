'use client';

import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** الدمّام — مركز افتراضي حين لا إحداثيات (شركة المرجع في المنطقة الشرقية). */
const DEFAULT_CENTER: [number, number] = [26.4207, 50.0888];

/**
 * أيقونة الدبّوس كـ SVG مضمّن — تتفادى صور Leaflet الافتراضية التي تنكسر
 * مع الحزم (bundlers) ولا تتطلّب أي أصل خارجي.
 */
function pinIcon() {
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    html:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'style="color:var(--primary);fill:var(--surface)">' +
      '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>' +
      '<circle cx="12" cy="10" r="3"/></svg>',
  });
}

/** يلتقط النقر على الخريطة فيحدّد الموقع. */
function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

/**
 * منتقي موقع الفرع على خريطة OpenStreetMap. انقر لتحديد الموقع أو اسحب الدبّوس.
 * يُحمَّل ديناميكياً (بلا SSR) لأن Leaflet يحتاج `window`.
 */
export default function LocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const hasPoint = lat !== null && lng !== null;
  const center: [number, number] = hasPoint ? [lat, lng] : DEFAULT_CENTER;
  const icon = useMemo(() => pinIcon(), []);

  return (
    <MapContainer
      center={center}
      zoom={hasPoint ? 14 : 11}
      scrollWheelZoom={false}
      className="h-64 w-full rounded border border-border"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickCapture onPick={onChange} />
      {hasPoint && (
        <Marker
          position={[lat, lng]}
          icon={icon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const p = (e.target as L.Marker).getLatLng();
              onChange(p.lat, p.lng);
            },
          }}
        />
      )}
    </MapContainer>
  );
}
