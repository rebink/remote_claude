import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { ProvisionPlan, ProvisionStep } from './types.ts';

/** Compute the ordered provisioning steps for a detected host. Pure. */
export function planProvision(d: DetectedServerPlatform): ProvisionPlan {
  const caps = d.capabilities;
  const steps: ProvisionStep[] = [
    { id: 'bootstrap-agent', title: 'Install Patchwire agent', requiresElevation: caps.packageManager.requiresElevation },
    { id: 'install-claude', title: 'Install Claude Code', requiresElevation: false },
    { id: 'install-mutagen', title: 'Install Mutagen', requiresElevation: false },
    { id: 'write-secret', title: 'Store agent token', requiresElevation: caps.secrets.requiresElevation },
    { id: 'install-service', title: 'Install agent service', requiresElevation: caps.service.requiresElevation },
    { id: 'apply-egress', title: 'Apply egress policy', requiresElevation: caps.egress.requiresElevation },
    { id: 'bind-tailnet', title: 'Bind to tailnet', requiresElevation: false },
  ];
  return { steps };
}

/** Steps that need elevation — surfaced to the client for the consent gate. */
export function elevationRequired(plan: ProvisionPlan): ProvisionStep[] {
  return plan.steps.filter((s) => s.requiresElevation);
}
