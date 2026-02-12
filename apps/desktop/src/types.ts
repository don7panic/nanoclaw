export type SetupStepId =
  | 'preflight'
  | 'install_dependencies'
  | 'container_runtime'
  | 'claude_auth'
  | 'build_agent_image'
  | 'discord_auth'
  | 'assistant_name'
  | 'security_confirmation'
  | 'register_main_channel'
  | 'mount_allowlist'
  | 'launchd_setup'
  | 'final_test';

export type StepStatus =
  | 'idle'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'done'
  | 'cancelled';

export interface ManualCheckpoint {
  id: string;
  title: string;
  instructions: string[];
  severity: 'info' | 'warning' | 'error';
  skippable: boolean;
  completed: boolean;
}

export interface SetupStepRuntime {
  id: SetupStepId;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  blockedReason: string | null;
  retryCount: number;
  manualCheckpoints: ManualCheckpoint[];
}

export interface SetupState {
  version: number;
  createdAt: string;
  updatedAt: string;
  currentStep: SetupStepId;
  selectedRuntime: 'apple_container' | 'docker' | null;
  steps: Record<SetupStepId, SetupStepRuntime>;
  cancelled: boolean;
}

export interface SetupLogEntry {
  timestamp: string;
  stepId: SetupStepId | 'system';
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface StartStepPayload {
  stepId: SetupStepId;
  data?: Record<string, unknown>;
}

export interface RetryStepPayload {
  stepId: SetupStepId;
}

export interface SkipManualCheckPayload {
  stepId: SetupStepId;
  checkpointId: string;
}

export interface SetupManualActionEvent {
  stepId: SetupStepId;
  reason: string;
  checkpoints: ManualCheckpoint[];
}

export const STEP_ORDER: Array<{ id: SetupStepId; title: string }> = [
  { id: 'preflight', title: 'Preflight Checks' },
  { id: 'install_dependencies', title: 'Install Dependencies' },
  { id: 'container_runtime', title: 'Container Runtime' },
  { id: 'claude_auth', title: 'Claude Authentication' },
  { id: 'build_agent_image', title: 'Build Agent Image' },
  { id: 'discord_auth', title: 'Discord Authentication' },
  { id: 'assistant_name', title: 'Assistant Identity' },
  { id: 'security_confirmation', title: 'Main Channel Security' },
  { id: 'register_main_channel', title: 'Register Main Channel' },
  { id: 'mount_allowlist', title: 'External Access Allowlist' },
  { id: 'launchd_setup', title: 'Background Service' },
  { id: 'final_test', title: 'Final Verification' },
];

export function createEmptyState(): SetupState {
  const now = new Date().toISOString();
  const steps = STEP_ORDER.reduce((acc, step) => {
    acc[step.id] = {
      id: step.id,
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      error: null,
      blockedReason: null,
      retryCount: 0,
      manualCheckpoints: [],
    };
    return acc;
  }, {} as SetupState['steps']);

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    currentStep: 'preflight',
    selectedRuntime: null,
    steps,
    cancelled: false,
  };
}
