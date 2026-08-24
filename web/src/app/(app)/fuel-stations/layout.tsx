import { FuelWorkspaceNav } from '@/components/fuel-stations/fuel-workspace-nav';

export default function FuelStationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <FuelWorkspaceNav />
      {children}
    </div>
  );
}
