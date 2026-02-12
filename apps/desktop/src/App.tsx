import { useCallback, useEffect, useState } from 'react';

import { MainDashboardView, type ConfigTaskId } from '@/features/main/MainDashboardView';
import { DependencySetupView } from '@/features/setup/DependencySetupView';
import {
  buildPayload,
  createDefaultDraft,
  hydrateDraft,
  type StepDraft,
} from '@/features/shared/setupDraft';
import { setup } from '@/lib/setupApi';
import {
  createEmptySnapshot,
  createEmptyState,
  type SetupLogEntry,
  type SetupManualActionEvent,
  type SetupSnapshot,
  type SetupState,
  type SetupStepId,
} from '@/types';

const DEPENDENCY_STEP_ORDER: SetupStepId[] = [
  'preflight',
  'install_dependencies',
  'container_runtime',
  'build_agent_image',
];

const CONFIG_TASK_ORDER: ConfigTaskId[] = [
  'claude_auth',
  'discord_auth',
  'register_main_channel',
  'mount_allowlist',
  'assistant_name',
  'launchd_setup',
];

function isDependencyStepSatisfied(
  stepId: SetupStepId,
  state: SetupState,
  snapshot: SetupSnapshot,
): boolean {
  switch (stepId) {
    case 'preflight':
      return (
        snapshot.dependencies.node &&
        snapshot.dependencies.npm &&
        snapshot.dependencies.claude &&
        snapshot.dependencies.repoWritable
      );
    case 'install_dependencies':
      return (
        snapshot.dependencies.workspaceDepsReady ||
        state.steps.install_dependencies.status === 'done'
      );
    case 'container_runtime':
      return snapshot.runtimeReady;
    case 'build_agent_image':
      return snapshot.imageBuilt;
    default:
      return false;
  }
}

function getNextDependencyStep(state: SetupState, snapshot: SetupSnapshot): SetupStepId {
  for (const stepId of DEPENDENCY_STEP_ORDER) {
    if (!isDependencyStepSatisfied(stepId, state, snapshot)) {
      return stepId;
    }
  }
  return DEPENDENCY_STEP_ORDER[DEPENDENCY_STEP_ORDER.length - 1];
}

function isTaskConfigured(snapshot: SetupSnapshot, taskId: ConfigTaskId): boolean {
  switch (taskId) {
    case 'claude_auth':
      return snapshot.claudeCredential.configured;
    case 'discord_auth':
      return snapshot.discordBotToken.configured;
    case 'register_main_channel':
      return snapshot.registeredMainChannel.configured;
    case 'mount_allowlist':
      return snapshot.mountAllowlistExists;
    case 'assistant_name':
      return Boolean(snapshot.assistantName);
    case 'launchd_setup':
      return snapshot.launchdLoaded;
    default:
      return false;
  }
}

function getNextTask(snapshot: SetupSnapshot): ConfigTaskId {
  for (const taskId of CONFIG_TASK_ORDER) {
    if (!isTaskConfigured(snapshot, taskId)) {
      return taskId;
    }
  }
  return CONFIG_TASK_ORDER[0];
}

function isConfigTask(stepId: SetupStepId): stepId is ConfigTaskId {
  return CONFIG_TASK_ORDER.includes(stepId as ConfigTaskId);
}

export default function App(): JSX.Element {
  const [state, setState] = useState<SetupState>(createEmptyState());
  const [snapshot, setSnapshot] = useState<SetupSnapshot>(createEmptySnapshot());
  const [view, setView] = useState<'setup' | 'main'>('setup');
  const [selectedDependencyStepId, setSelectedDependencyStepId] =
    useState<SetupStepId>('preflight');
  const [selectedTaskId, setSelectedTaskId] = useState<ConfigTaskId>('claude_auth');
  const [logs, setLogs] = useState<SetupLogEntry[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StepDraft>(createDefaultDraft(createEmptySnapshot()));
  const [busy, setBusy] = useState(false);
  const [lastManualAction, setLastManualAction] =
    useState<SetupManualActionEvent | null>(null);

  const refreshSnapshot = useCallback(async (): Promise<SetupSnapshot | null> => {
    try {
      const next = await setup.getSnapshot();
      setSnapshot(next);
      return next;
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const bootstrap = async () => {
      try {
        const [loadedState, loadedSnapshot] = await Promise.all([
          setup.getState(),
          setup.getSnapshot(),
        ]);
        if (disposed) return;
        setState(loadedState);
        setSnapshot(loadedSnapshot);
        setDraft(hydrateDraft(loadedState, loadedSnapshot));
        setSelectedDependencyStepId(getNextDependencyStep(loadedState, loadedSnapshot));
        setSelectedTaskId(getNextTask(loadedSnapshot));
        setView(loadedSnapshot.canRunCore ? 'main' : 'setup');

        unlisten = await setup.subscribe({
          onLog: (entry) => {
            setLogs((prev) => [...prev.slice(-399), entry]);
          },
          onState: (nextState) => {
            setState(nextState);
            if (DEPENDENCY_STEP_ORDER.includes(nextState.currentStep)) {
              setSelectedDependencyStepId(nextState.currentStep);
            }
            if (isConfigTask(nextState.currentStep)) {
              setSelectedTaskId(nextState.currentStep);
            }
            void refreshSnapshot().then((nextSnapshot) => {
              if (!nextSnapshot || disposed) return;
              setView(nextSnapshot.canRunCore ? 'main' : 'setup');
            });
          },
          onManualAction: (event) => {
            setLastManualAction(event);
            if (DEPENDENCY_STEP_ORDER.includes(event.stepId)) {
              setSelectedDependencyStepId(event.stepId);
              setView('setup');
            } else if (isConfigTask(event.stepId)) {
              setSelectedTaskId(event.stepId);
              setView('main');
            }
          },
          onFatalError: (event) => {
            setFatalError(event.message);
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setFatalError(message);
      }
    };

    void bootstrap();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [refreshSnapshot]);

  const syncDraftSnapshot = useCallback((nextSnapshot: SetupSnapshot) => {
    setDraft((prev) => ({
      ...prev,
      assistantName: nextSnapshot.assistantName || prev.assistantName,
      mainChannelId: nextSnapshot.registeredMainChannel.channelId || prev.mainChannelId,
      mainChannelName:
        nextSnapshot.registeredMainChannel.name || prev.mainChannelName,
      mainChannelFolder:
        nextSnapshot.registeredMainChannel.folder || prev.mainChannelFolder,
    }));
  }, []);

  const runGuidedSetup = useCallback(async () => {
    setBusy(true);
    setFatalError(null);
    setLastManualAction(null);

    try {
      let currentState = state;
      let currentSnapshot = (await refreshSnapshot()) || snapshot;

      for (const stepId of DEPENDENCY_STEP_ORDER) {
        if (isDependencyStepSatisfied(stepId, currentState, currentSnapshot)) {
          continue;
        }

        setSelectedDependencyStepId(stepId);
        const next = await setup.startStep({
          stepId,
          data: buildPayload(stepId, draft),
        });
        currentState = next;
        setState(next);

        const refreshedSnapshot = await refreshSnapshot();
        if (refreshedSnapshot) {
          currentSnapshot = refreshedSnapshot;
          syncDraftSnapshot(refreshedSnapshot);
        }

        const stepStatus = next.steps[stepId].status;
        if (
          stepStatus === 'blocked' ||
          stepStatus === 'failed' ||
          stepStatus === 'cancelled'
        ) {
          break;
        }
      }

      if (currentSnapshot.canRunCore) {
        setSelectedTaskId(getNextTask(currentSnapshot));
        setView('main');
      } else {
        setSelectedDependencyStepId(getNextDependencyStep(currentState, currentSnapshot));
        setView('setup');
      }
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
      setView('setup');
    } finally {
      setBusy(false);
    }
  }, [draft, refreshSnapshot, snapshot, state, syncDraftSnapshot]);

  const runDependencyStep = useCallback(
    async (retry = false) => {
      setBusy(true);
      setFatalError(null);
      try {
        const next = retry
          ? await setup.retryStep({ stepId: selectedDependencyStepId })
          : await setup.startStep({
              stepId: selectedDependencyStepId,
              data: buildPayload(selectedDependencyStepId, draft),
            });

        setState(next);
        const nextSnapshot = await refreshSnapshot();
        if (nextSnapshot) {
          syncDraftSnapshot(nextSnapshot);
          if (nextSnapshot.canRunCore) {
            setSelectedTaskId(getNextTask(nextSnapshot));
            setView('main');
          }
        }
      } catch (err) {
        setFatalError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [draft, refreshSnapshot, selectedDependencyStepId, syncDraftSnapshot],
  );

  const runTaskStep = useCallback(
    async (taskId: ConfigTaskId, retry = false) => {
      setBusy(true);
      setFatalError(null);
      setSelectedTaskId(taskId);
      try {
        const next = retry
          ? await setup.retryStep({ stepId: taskId })
          : await setup.startStep({
              stepId: taskId,
              data: buildPayload(taskId, draft),
            });
        setState(next);
        const nextSnapshot = await refreshSnapshot();
        if (nextSnapshot) {
          syncDraftSnapshot(nextSnapshot);
        }
      } catch (err) {
        setFatalError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [draft, refreshSnapshot, syncDraftSnapshot],
  );

  const markCheckpoint = useCallback(
    async (checkpointId: string) => {
      setBusy(true);
      setFatalError(null);
      try {
        const next = await setup.skipManualCheck({
          stepId: selectedDependencyStepId,
          checkpointId,
        });
        setState(next);
        await refreshSnapshot();
      } catch (err) {
        setFatalError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot, selectedDependencyStepId],
  );

  const cancelSetup = useCallback(async () => {
    setBusy(true);
    setFatalError(null);
    try {
      const next = await setup.cancel();
      setState(next);
      await refreshSnapshot();
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [refreshSnapshot]);

  const setupComplete = snapshot.canRunCore;

  if (view === 'setup') {
    return (
      <DependencySetupView
        busy={busy}
        fatalError={fatalError}
        lastManualAction={lastManualAction}
        logs={logs}
        onCancelSetup={cancelSetup}
        onMarkCheckpoint={markCheckpoint}
        onOpenDashboard={() => {
          if (snapshot.canRunCore) {
            setSelectedTaskId(getNextTask(snapshot));
            setView('main');
          }
        }}
        onRunGuidedSetup={runGuidedSetup}
        onRunSelectedStep={runDependencyStep}
        onSelectStep={setSelectedDependencyStepId}
        selectedStepId={selectedDependencyStepId}
        setupComplete={setupComplete}
        snapshot={snapshot}
        state={state}
      />
    );
  }

  return (
    <MainDashboardView
      busy={busy}
      draft={draft}
      fatalError={fatalError}
      logs={logs}
      onRefreshSnapshot={async () => {
        const nextSnapshot = await refreshSnapshot();
        if (nextSnapshot && !nextSnapshot.canRunCore) {
          setSelectedDependencyStepId(getNextDependencyStep(state, nextSnapshot));
          setView('setup');
        }
      }}
      onRunTask={runTaskStep}
      onSelectTask={setSelectedTaskId}
      selectedTaskId={selectedTaskId}
      setDraft={setDraft}
      snapshot={snapshot}
      state={state}
    />
  );
}
