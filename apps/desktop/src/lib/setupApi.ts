import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  createEmptyState,
  type RetryStepPayload,
  type SkipManualCheckPayload,
  type StartStepPayload,
  type SetupLogEntry,
  type SetupManualActionEvent,
  type SetupState,
} from '../types';

interface SetupEvents {
  onLog?: (entry: SetupLogEntry) => void;
  onState?: (state: SetupState) => void;
  onManualAction?: (event: SetupManualActionEvent) => void;
  onFatalError?: (error: { message: string }) => void;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invokeOrMock<T>(command: string, payload?: object): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(command, payload);
  }

  if (command === 'setup_get_state') {
    return createEmptyState() as T;
  }

  throw new Error('Tauri runtime is required for setup execution.');
}

export const setup = {
  async getState(): Promise<SetupState> {
    return invokeOrMock<SetupState>('setup_get_state');
  },

  async startStep(payload: StartStepPayload): Promise<SetupState> {
    return invokeOrMock<SetupState>('setup_start_step', { payload });
  },

  async retryStep(payload: RetryStepPayload): Promise<SetupState> {
    return invokeOrMock<SetupState>('setup_retry_step', { payload });
  },

  async skipManualCheck(payload: SkipManualCheckPayload): Promise<SetupState> {
    return invokeOrMock<SetupState>('setup_skip_manual_check', { payload });
  },

  async cancel(): Promise<SetupState> {
    return invokeOrMock<SetupState>('setup_cancel');
  },

  async subscribe(events: SetupEvents): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => {};
    }

    const unlisteners: UnlistenFn[] = [];

    unlisteners.push(
      await listen<SetupLogEntry>('setup://log', ({ payload }) => {
        events.onLog?.(payload);
      }),
    );

    unlisteners.push(
      await listen<SetupState>('setup://step-status', ({ payload }) => {
        events.onState?.(payload);
      }),
    );

    unlisteners.push(
      await listen<SetupManualActionEvent>(
        'setup://requires-user-action',
        ({ payload }) => {
          events.onManualAction?.(payload);
        },
      ),
    );

    unlisteners.push(
      await listen<{ message: string }>('setup://fatal-error', ({ payload }) => {
        events.onFatalError?.(payload);
      }),
    );

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  },
};
