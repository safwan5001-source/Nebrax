export type ApplicationMaturity = 'built' | 'coming_soon' | 'retired';
export type ApplicationEffectiveAccess = 'full' | 'read_only' | 'denied';
export type ApplicationOperationalStatus = 'enabled' | 'disabled' | 'suspended';
export type ApplicationDependencyStatus = 'satisfied' | 'missing' | 'not_applicable';

export type ApplicationManagementAction =
  | { kind: 'enable' }
  | { kind: 'disable' }
  | { kind: 'blocked'; reason: 'access_denied' | 'read_only' | 'dependencies_missing' }
  | { kind: 'unavailable'; reason: 'mandatory' | 'not_built' | 'suspended' };

export interface ApplicationManagementActionInput {
  maturity: ApplicationMaturity;
  mandatory: boolean;
  effectiveAccess: ApplicationEffectiveAccess;
  status: ApplicationOperationalStatus;
  dependencyStatus: ApplicationDependencyStatus;
}

/**
 * Chooses the frontend operation from the application's operational facts.
 * Commercial availability is deliberately excluded: it is display metadata,
 * while effective access is the authoritative input for operability.
 */
export function resolveApplicationManagementAction({
  maturity,
  mandatory,
  effectiveAccess,
  status,
  dependencyStatus,
}: ApplicationManagementActionInput): ApplicationManagementAction {
  if (maturity !== 'built') return { kind: 'unavailable', reason: 'not_built' };
  if (mandatory) return { kind: 'unavailable', reason: 'mandatory' };

  if (effectiveAccess === 'denied') return { kind: 'blocked', reason: 'access_denied' };
  if (effectiveAccess === 'read_only') return { kind: 'blocked', reason: 'read_only' };

  if (status === 'enabled') return { kind: 'disable' };
  if (status === 'suspended') return { kind: 'unavailable', reason: 'suspended' };

  if (dependencyStatus === 'missing') return { kind: 'blocked', reason: 'dependencies_missing' };
  return { kind: 'enable' };
}
