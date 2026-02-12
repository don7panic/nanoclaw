import {
  ManualCheckpoint,
  SETUP_STATE_VERSION,
  SetupState,
  SetupStepId,
  SetupStepRuntime,
  StepStatus,
} from './schema.js';
import { FIRST_STEP_ID, SETUP_STEPS, getStepById } from './steps.js';

function nowIso(): string {
  return new Date().toISOString();
}

function createRuntime(stepId: SetupStepId): SetupStepRuntime {
  return {
    id: stepId,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    error: null,
    blockedReason: null,
    retryCount: 0,
    manualCheckpoints: [],
  };
}

export function createInitialSetupState(): SetupState {
  const steps = {} as Record<SetupStepId, SetupStepRuntime>;
  for (const step of SETUP_STEPS) {
    steps[step.id] = createRuntime(step.id);
  }

  const timestamp = nowIso();
  return {
    version: SETUP_STATE_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentStep: FIRST_STEP_ID,
    selectedRuntime: null,
    steps,
    cancelled: false,
  };
}

export function startStep(state: SetupState, stepId: SetupStepId): SetupState {
  const runtime = state.steps[stepId];
  const timestamp = nowIso();

  return {
    ...state,
    updatedAt: timestamp,
    currentStep: stepId,
    steps: {
      ...state.steps,
      [stepId]: {
        ...runtime,
        status: 'running',
        startedAt: runtime.startedAt ?? timestamp,
        finishedAt: null,
        error: null,
        blockedReason: null,
      },
    },
  };
}

export function completeStep(
  state: SetupState,
  stepId: SetupStepId,
  options?: { nextStepId?: SetupStepId },
): SetupState {
  const runtime = state.steps[stepId];
  const step = getStepById(stepId);
  const nextStep = options?.nextStepId || step.next || stepId;
  const timestamp = nowIso();

  return {
    ...state,
    updatedAt: timestamp,
    currentStep: nextStep,
    steps: {
      ...state.steps,
      [stepId]: {
        ...runtime,
        status: 'done',
        finishedAt: timestamp,
        blockedReason: null,
        error: null,
      },
    },
  };
}

export function failStep(
  state: SetupState,
  stepId: SetupStepId,
  error: string,
): SetupState {
  const runtime = state.steps[stepId];
  const timestamp = nowIso();

  return {
    ...state,
    updatedAt: timestamp,
    currentStep: stepId,
    steps: {
      ...state.steps,
      [stepId]: {
        ...runtime,
        status: 'failed',
        finishedAt: timestamp,
        error,
        blockedReason: null,
      },
    },
  };
}

export function blockStep(
  state: SetupState,
  stepId: SetupStepId,
  reason: string,
  manualCheckpoints: ManualCheckpoint[],
): SetupState {
  const runtime = state.steps[stepId];
  const timestamp = nowIso();

  return {
    ...state,
    updatedAt: timestamp,
    currentStep: stepId,
    steps: {
      ...state.steps,
      [stepId]: {
        ...runtime,
        status: 'blocked',
        blockedReason: reason,
        finishedAt: timestamp,
        manualCheckpoints,
      },
    },
  };
}

export function retryStep(state: SetupState, stepId: SetupStepId): SetupState {
  const runtime = state.steps[stepId];
  const timestamp = nowIso();

  return {
    ...state,
    updatedAt: timestamp,
    currentStep: stepId,
    steps: {
      ...state.steps,
      [stepId]: {
        ...runtime,
        retryCount: runtime.retryCount + 1,
        status: 'running',
        error: null,
        blockedReason: null,
        finishedAt: null,
      },
    },
  };
}

export function markManualCheckpoint(
  state: SetupState,
  stepId: SetupStepId,
  checkpointId: string,
): SetupState {
  const runtime = state.steps[stepId];
  const checkpoints = runtime.manualCheckpoints.map((item) =>
    item.id === checkpointId ? { ...item, completed: true } : item,
  );

  return {
    ...state,
    updatedAt: nowIso(),
    steps: {
      ...state.steps,
      [stepId]: {
        ...runtime,
        manualCheckpoints: checkpoints,
      },
    },
  };
}

export function cancelSetup(state: SetupState): SetupState {
  const timestamp = nowIso();
  return {
    ...state,
    cancelled: true,
    updatedAt: timestamp,
    steps: {
      ...state.steps,
      [state.currentStep]: {
        ...state.steps[state.currentStep],
        status: 'cancelled' as StepStatus,
        finishedAt: timestamp,
      },
    },
  };
}
