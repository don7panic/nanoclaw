import { type Dispatch, type JSX, type SetStateAction, useEffect, useMemo, useState } from 'react';

import { setup } from './lib/setupApi';
import {
  STEP_ORDER,
  createEmptyState,
  type SetupLogEntry,
  type SetupManualActionEvent,
  type SetupState,
  type SetupStepId,
} from './types';

type RuntimeChoice = 'apple_container' | 'docker';
type ClaudeAuthMethod = 'oauth' | 'api_key';

interface AllowRootInput {
  path: string;
  allowReadWrite: boolean;
  description: string;
}

interface StepDraft {
  containerRuntime: RuntimeChoice;
  claudeAuthMethod: ClaudeAuthMethod;
  claudeToken: string;
  discordBotToken: string;
  discordAppId: string;
  assistantName: string;
  securityConfirmed: boolean;
  mainChannelId: string;
  mainChannelName: string;
  mainChannelFolder: string;
  mountNonMainReadOnly: boolean;
  mountRoots: AllowRootInput[];
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'done':
      return 'Done';
    case 'running':
      return 'Running';
    case 'blocked':
      return 'Manual Action';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

function createDefaultDraft(): StepDraft {
  return {
    containerRuntime: 'apple_container',
    claudeAuthMethod: 'oauth',
    claudeToken: '',
    discordBotToken: '',
    discordAppId: '',
    assistantName: 'Andy',
    securityConfirmed: false,
    mainChannelId: '',
    mainChannelName: 'main',
    mainChannelFolder: 'main',
    mountNonMainReadOnly: true,
    mountRoots: [
      {
        path: '~/projects',
        allowReadWrite: true,
        description: 'Development projects',
      },
    ],
  };
}

export default function App() {
  const [state, setState] = useState<SetupState>(createEmptyState());
  const [selectedStepId, setSelectedStepId] = useState<SetupStepId>('preflight');
  const [logs, setLogs] = useState<SetupLogEntry[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StepDraft>(createDefaultDraft());
  const [busy, setBusy] = useState(false);
  const [lastManualAction, setLastManualAction] =
    useState<SetupManualActionEvent | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const bootstrap = async () => {
      try {
        const loaded = await setup.getState();
        if (disposed) return;
        setState(loaded);
        setSelectedStepId(loaded.currentStep);

        unlisten = await setup.subscribe({
          onLog: (entry) => {
            setLogs((prev) => [...prev.slice(-399), entry]);
          },
          onState: (nextState) => {
            setState(nextState);
            setSelectedStepId(nextState.currentStep);
          },
          onManualAction: (event) => {
            setLastManualAction(event);
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

    bootstrap();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const selectedRuntime = state.steps[selectedStepId];
  const completedCount = useMemo(
    () => STEP_ORDER.filter((step) => state.steps[step.id].status === 'done').length,
    [state],
  );

  const runStep = async (retry = false) => {
    setBusy(true);
    setFatalError(null);
    try {
      if (retry) {
        const next = await setup.retryStep({ stepId: selectedStepId });
        setState(next);
      } else {
        const next = await setup.startStep({
          stepId: selectedStepId,
          data: buildPayload(selectedStepId, draft),
        });
        setState(next);
      }
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const markCheckpoint = async (checkpointId: string) => {
    setBusy(true);
    setFatalError(null);
    try {
      const next = await setup.skipManualCheck({
        stepId: selectedStepId,
        checkpointId,
      });
      setState(next);
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = async () => {
    setBusy(true);
    setFatalError(null);
    try {
      const next = await setup.cancel();
      setState(next);
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-shell">
      <div className="background-art" />
      <aside className="left-rail card reveal-a">
        <header>
          <p className="eyebrow">NanoClaw Desktop Setup</p>
          <h1>Mission Control</h1>
          <p className="muted">
            Human-first onboarding for a secure local assistant.
          </p>
        </header>

        <div className="progress-block">
          <div className="progress-meta">
            <span>{completedCount}/12 completed</span>
            <span>{state.cancelled ? 'Cancelled' : 'Active'}</span>
          </div>
          <div className="progress-track" aria-hidden>
            <div
              className="progress-fill"
              style={{ width: `${(completedCount / 12) * 100}%` }}
            />
          </div>
        </div>

        <nav className="step-list" aria-label="Setup steps">
          {STEP_ORDER.map((step) => {
            const runtime = state.steps[step.id];
            const active = selectedStepId === step.id;
            return (
              <button
                key={step.id}
                className={`step-pill status-${runtime.status} ${active ? 'active' : ''}`}
                onClick={() => setSelectedStepId(step.id)}
                type="button"
              >
                <span className="step-title">{step.title}</span>
                <span className="step-status">{getStatusLabel(runtime.status)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="center-stage card reveal-b">
        <header className="center-header">
          <div>
            <p className="eyebrow">Current Step</p>
            <h2>
              {STEP_ORDER.find((step) => step.id === selectedStepId)?.title}
            </h2>
          </div>
          <span className={`badge badge-${selectedRuntime.status}`}>
            {getStatusLabel(selectedRuntime.status)}
          </span>
        </header>

        {fatalError ? <p className="alert alert-error">{fatalError}</p> : null}

        {lastManualAction && lastManualAction.stepId === selectedStepId ? (
          <section className="alert alert-warning">
            <h3>Manual Action Required</h3>
            <p>{lastManualAction.reason}</p>
          </section>
        ) : null}

        <section className="form-panel">{renderStepFields(selectedStepId, draft, setDraft)}</section>

        {selectedRuntime.blockedReason ? (
          <section className="manual-panel">
            <p className="eyebrow">Blocked Reason</p>
            <p>{selectedRuntime.blockedReason}</p>
            <div className="manual-checks">
              {selectedRuntime.manualCheckpoints.map((checkpoint) => (
                <article key={checkpoint.id} className="manual-check-card">
                  <h4>{checkpoint.title}</h4>
                  <ul>
                    {checkpoint.instructions.map((instruction) => (
                      <li key={instruction}>{instruction}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={busy || checkpoint.completed}
                    onClick={() => markCheckpoint(checkpoint.id)}
                  >
                    {checkpoint.completed ? 'Acknowledged' : 'Mark Completed'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <div className="actions-row">
          <button type="button" disabled={busy} onClick={() => runStep(false)}>
            Run Step
          </button>
          <button type="button" disabled={busy} onClick={() => runStep(true)}>
            Retry Step
          </button>
          <button type="button" disabled={busy} className="ghost" onClick={cancelSetup}>
            Cancel Setup
          </button>
        </div>
      </main>

      <aside className="right-log card reveal-c">
        <header className="log-header">
          <p className="eyebrow">Live Stream</p>
          <h3>Execution Log</h3>
        </header>

        <div className="log-list" role="log" aria-live="polite">
          {logs.length === 0 ? (
            <p className="muted">No runtime output yet. Start with Preflight.</p>
          ) : (
            logs
              .slice()
              .reverse()
              .map((entry) => (
                <article key={`${entry.timestamp}-${entry.message}`} className={`log-entry ${entry.level}`}>
                  <p>
                    <span>{entry.timestamp}</span>
                    <strong>{entry.stepId}</strong>
                  </p>
                  <p>{entry.message}</p>
                </article>
              ))
          )}
        </div>
      </aside>
    </div>
  );
}

function buildPayload(stepId: SetupStepId, draft: StepDraft): Record<string, unknown> {
  switch (stepId) {
    case 'container_runtime':
      return { runtime: draft.containerRuntime };
    case 'claude_auth':
      return {
        method: draft.claudeAuthMethod,
        token: draft.claudeToken,
      };
    case 'discord_auth':
      return {
        discordBotToken: draft.discordBotToken,
        discordAppId: draft.discordAppId,
      };
    case 'assistant_name':
      return { assistantName: draft.assistantName };
    case 'security_confirmation':
      return { confirmed: draft.securityConfirmed };
    case 'register_main_channel':
      return {
        channelId: draft.mainChannelId,
        name: draft.mainChannelName,
        folder: draft.mainChannelFolder,
        trigger: `@${draft.assistantName}`,
      };
    case 'mount_allowlist':
      return {
        nonMainReadOnly: draft.mountNonMainReadOnly,
        allowedRoots: draft.mountRoots,
      };
    default:
      return {};
  }
}

function renderStepFields(
  stepId: SetupStepId,
  draft: StepDraft,
  setDraft: Dispatch<SetStateAction<StepDraft>>,
): JSX.Element {
  if (stepId === 'container_runtime') {
    return (
      <section className="field-stack">
        <h3>Choose Runtime</h3>
        <div className="segmented-row">
          <label>
            <input
              type="radio"
              name="runtime"
              checked={draft.containerRuntime === 'apple_container'}
              onChange={() =>
                setDraft((prev) => ({ ...prev, containerRuntime: 'apple_container' }))
              }
            />
            Apple Container (recommended on macOS)
          </label>
          <label>
            <input
              type="radio"
              name="runtime"
              checked={draft.containerRuntime === 'docker'}
              onChange={() => setDraft((prev) => ({ ...prev, containerRuntime: 'docker' }))}
            />
            Docker
          </label>
        </div>
      </section>
    );
  }

  if (stepId === 'claude_auth') {
    return (
      <section className="field-stack">
        <h3>Claude Credentials</h3>
        <label>
          Method
          <select
            value={draft.claudeAuthMethod}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                claudeAuthMethod: event.target.value as ClaudeAuthMethod,
              }))
            }
          >
            <option value="oauth">Claude subscription token</option>
            <option value="api_key">Anthropic API key</option>
          </select>
        </label>
        <label>
          Token
          <input
            type="password"
            value={draft.claudeToken}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, claudeToken: event.target.value }))
            }
            placeholder={
              draft.claudeAuthMethod === 'oauth'
                ? 'sk-ant-oat01-...'
                : 'sk-ant-api03-...'
            }
          />
        </label>
      </section>
    );
  }

  if (stepId === 'discord_auth') {
    return (
      <section className="field-stack">
        <h3>Discord Bot Credentials</h3>
        <label>
          Bot Token
          <input
            type="password"
            value={draft.discordBotToken}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, discordBotToken: event.target.value }))
            }
            placeholder="Paste bot token"
          />
        </label>
        <label>
          App ID (optional)
          <input
            type="text"
            value={draft.discordAppId}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, discordAppId: event.target.value }))
            }
            placeholder="123456789012345678"
          />
        </label>
      </section>
    );
  }

  if (stepId === 'assistant_name') {
    return (
      <section className="field-stack">
        <h3>Assistant Identity</h3>
        <label>
          Assistant Name
          <input
            type="text"
            value={draft.assistantName}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, assistantName: event.target.value }))
            }
            placeholder="Andy"
          />
        </label>
        <p className="inline-note">Trigger preview: @{draft.assistantName || 'Andy'} hello</p>
      </section>
    );
  }

  if (stepId === 'security_confirmation') {
    return (
      <section className="field-stack">
        <h3>Main Channel Security Confirmation</h3>
        <p className="inline-note">
          The main channel can administer all groups, tasks, and global memory.
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.securityConfirmed}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, securityConfirmed: event.target.checked }))
            }
          />
          I understand the privileges and accept the risk.
        </label>
      </section>
    );
  }

  if (stepId === 'register_main_channel') {
    return (
      <section className="field-stack">
        <h3>Main Channel Registration</h3>
        <label>
          Channel ID (leave blank to auto-detect latest)
          <input
            type="text"
            value={draft.mainChannelId}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, mainChannelId: event.target.value }))
            }
          />
        </label>
        <label>
          Group Name
          <input
            type="text"
            value={draft.mainChannelName}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, mainChannelName: event.target.value }))
            }
          />
        </label>
        <label>
          Folder Name
          <input
            type="text"
            value={draft.mainChannelFolder}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, mainChannelFolder: event.target.value }))
            }
          />
        </label>
      </section>
    );
  }

  if (stepId === 'mount_allowlist') {
    return (
      <section className="field-stack">
        <h3>External Directory Access</h3>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.mountNonMainReadOnly}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                mountNonMainReadOnly: event.target.checked,
              }))
            }
          />
          Force non-main groups to read-only
        </label>

        {draft.mountRoots.map((root, index) => (
          <div key={`${root.path}-${index}`} className="mount-row">
            <input
              type="text"
              value={root.path}
              onChange={(event) =>
                setDraft((prev) => {
                  const next = [...prev.mountRoots];
                  next[index] = { ...next[index], path: event.target.value };
                  return { ...prev, mountRoots: next };
                })
              }
              placeholder="~/projects"
            />
            <input
              type="text"
              value={root.description}
              onChange={(event) =>
                setDraft((prev) => {
                  const next = [...prev.mountRoots];
                  next[index] = {
                    ...next[index],
                    description: event.target.value,
                  };
                  return { ...prev, mountRoots: next };
                })
              }
              placeholder="Description"
            />
            <label className="checkbox-row compact">
              <input
                type="checkbox"
                checked={root.allowReadWrite}
                onChange={(event) =>
                  setDraft((prev) => {
                    const next = [...prev.mountRoots];
                    next[index] = {
                      ...next[index],
                      allowReadWrite: event.target.checked,
                    };
                    return { ...prev, mountRoots: next };
                  })
                }
              />
              Read-write
            </label>
          </div>
        ))}

        <button
          type="button"
          className="ghost"
          onClick={() =>
            setDraft((prev) => ({
              ...prev,
              mountRoots: [
                ...prev.mountRoots,
                {
                  path: '',
                  description: '',
                  allowReadWrite: false,
                },
              ],
            }))
          }
        >
          Add Allowlist Root
        </button>
      </section>
    );
  }

  return (
    <section className="field-stack">
      <h3>Execution Notes</h3>
      <p className="inline-note">
        This step has no custom inputs. Press <strong>Run Step</strong> to execute.
      </p>
    </section>
  );
}
