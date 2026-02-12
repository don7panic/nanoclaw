import {
  createEmptySnapshot,
  createEmptyState,
  type RetryStepPayload,
  type SkipManualCheckPayload,
  type StartStepPayload,
  type SetupLogEntry,
  type SetupManualActionEvent,
  type SetupSnapshot,
  type SetupState,
} from '../types';

interface SetupEvents {
  onLog?: (entry: SetupLogEntry) => void;
  onState?: (state: SetupState) => void;
  onManualAction?: (event: SetupManualActionEvent) => void;
  onFatalError?: (error: { message: string }) => void;
}

const API_BASE = '/api/setup';

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Request failed';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) {
        message = payload.message;
      }
    } catch {
      // Keep default message if response body is not JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function requestWithFallback<T>(
  run: () => Promise<T>,
  fallback: () => T,
): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback();
  }
}

export const setup = {
  async getState(): Promise<SetupState> {
    return requestWithFallback(
      () => requestJson<SetupState>('/state'),
      () => createEmptyState(),
    );
  },

  async getSnapshot(): Promise<SetupSnapshot> {
    return requestWithFallback(
      () => requestJson<SetupSnapshot>('/snapshot'),
      () => createEmptySnapshot(),
    );
  },

  async startStep(payload: StartStepPayload): Promise<SetupState> {
    return requestJson<SetupState>('/start-step', {
      method: 'POST',
      body: JSON.stringify({ payload }),
    });
  },

  async retryStep(payload: RetryStepPayload): Promise<SetupState> {
    return requestJson<SetupState>('/retry-step', {
      method: 'POST',
      body: JSON.stringify({ payload }),
    });
  },

  async skipManualCheck(payload: SkipManualCheckPayload): Promise<SetupState> {
    return requestJson<SetupState>('/skip-manual-check', {
      method: 'POST',
      body: JSON.stringify({ payload }),
    });
  },

  async cancel(): Promise<SetupState> {
    return requestJson<SetupState>('/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async subscribe(events: SetupEvents): Promise<() => void> {
    const source = new EventSource(`${API_BASE}/events`);

    const onLog = (event: MessageEvent<string>) => {
      try {
        events.onLog?.(JSON.parse(event.data) as SetupLogEntry);
      } catch (error) {
        events.onFatalError?.({ message: parseErrorMessage(error) });
      }
    };

    const onState = (event: MessageEvent<string>) => {
      try {
        events.onState?.(JSON.parse(event.data) as SetupState);
      } catch (error) {
        events.onFatalError?.({ message: parseErrorMessage(error) });
      }
    };

    const onManualAction = (event: MessageEvent<string>) => {
      try {
        events.onManualAction?.(JSON.parse(event.data) as SetupManualActionEvent);
      } catch (error) {
        events.onFatalError?.({ message: parseErrorMessage(error) });
      }
    };

    const onFatalError = (event: MessageEvent<string>) => {
      try {
        events.onFatalError?.(JSON.parse(event.data) as { message: string });
      } catch (error) {
        events.onFatalError?.({ message: parseErrorMessage(error) });
      }
    };

    const onConnectionError = () => {
      events.onFatalError?.({ message: 'Lost connection to setup server.' });
    };

    source.addEventListener('setup://log', onLog as EventListener);
    source.addEventListener('setup://step-status', onState as EventListener);
    source.addEventListener(
      'setup://requires-user-action',
      onManualAction as EventListener,
    );
    source.addEventListener('setup://fatal-error', onFatalError as EventListener);
    source.addEventListener('error', onConnectionError as EventListener);

    return () => {
      source.removeEventListener('setup://log', onLog as EventListener);
      source.removeEventListener('setup://step-status', onState as EventListener);
      source.removeEventListener(
        'setup://requires-user-action',
        onManualAction as EventListener,
      );
      source.removeEventListener('setup://fatal-error', onFatalError as EventListener);
      source.removeEventListener('error', onConnectionError as EventListener);
      source.close();
    };
  },
};
