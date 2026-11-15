import type { Metadata } from 'next';
import { stationOpsPwaMetadata, stationOpsViewport } from '@/modules/station-ops/pwa-metadata';
import { StationOpsGuard } from '@/modules/station-ops/guard';
import '@/modules/station-ops/fuel-ops.css';

/**
 * «تشغيل المحطات | Station Operations» — مساحة جوال للبائع والمشرف فوق وحدة محطات الوقود في أَوْج.
 * مجموعة مسارات مستقلة عن `(fuel)` (مكتبية بشريط جانبي) لتملك غلافها الخاص دون المساس بها، وتبقى تحت `/fuel-stations`
 * المستثنى أصلاً من بوابة AWJ v3. لا مصادقة ولا جلسة مستقلة: نفس توكن أَوْج وحارس الدخول نفسه.
 */
export const metadata: Metadata = {
  title: 'محطات أَوْج | AWJ Fuel Stations',
  description: 'Station Operations — AWJ Fuel Stations',
  ...stationOpsPwaMetadata,
};

export const viewport = stationOpsViewport;

export default function FuelOpsLayout({ children }: { children: React.ReactNode }) {
  return <StationOpsGuard>{children}</StationOpsGuard>;
}
