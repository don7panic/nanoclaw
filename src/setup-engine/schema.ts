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

export type SetupSeverity = 'info' | 'warning' | 'error';

export interface ManualCheckpoint {
  id: string;
  title: string;
  instructions: string[];
  severity: SetupSeverity;
  skippable: boolean;
  completed: boolean;
}

export interface SetupStepDefinition {
  id: SetupStepId;
  title: string;
  summary: string;
  order: number;
  skippable: boolean;
  next?: SetupStepId;
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
  level: SetupSeverity;
  message: string;
}

export interface SetupReport {
  generatedAt: string;
  success: boolean;
  steps: Array<{
    id: SetupStepId;
    status: StepStatus;
    notes: string[];
  }>;
  logs: SetupLogEntry[];
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

export const SETUP_STATE_VERSION = 1;
