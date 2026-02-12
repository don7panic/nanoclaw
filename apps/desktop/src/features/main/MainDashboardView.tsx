import { type Dispatch, type SetStateAction } from 'react';

import { type StepDraft } from '@/features/shared/setupDraft';
import { type SetupLogEntry, type SetupSnapshot, type SetupState, type SetupStepId } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { StatusBreathingDot, type BreathingStatus } from '@/features/common/StatusBreathingDot';
import { cn } from '@/lib/utils';

type ConfigTaskId =
  | 'claude_auth'
  | 'discord_auth'
  | 'register_main_channel'
  | 'mount_allowlist'
  | 'assistant_name'
  | 'launchd_setup';

const CONFIG_TASKS: Array<{
  id: ConfigTaskId;
  title: string;
  summary: string;
}> = [
    {
      id: 'claude_auth',
      title: 'Claude Credential',
      summary: 'Provide subscription token or API key',
    },
    {
      id: 'discord_auth',
      title: 'Discord Bot Token',
      summary: 'Attach bot token used for message IO',
    },
    {
      id: 'register_main_channel',
      title: 'Register Main Channel',
      summary: 'Select control channel for admin tasks',
    },
    {
      id: 'mount_allowlist',
      title: 'Mount Project Allowlist',
      summary: 'Define safe host folders for mounts',
    },
    {
      id: 'assistant_name',
      title: 'Assistant Name',
      summary: 'Set the mention trigger label',
    },
    {
      id: 'launchd_setup',
      title: 'Launchd Service',
      summary: 'Configure optional background service',
    },
  ];

interface MainDashboardViewProps {
  state: SetupState;
  snapshot: SetupSnapshot;
  logs: SetupLogEntry[];
  draft: StepDraft;
  setDraft: Dispatch<SetStateAction<StepDraft>>;
  selectedTaskId: ConfigTaskId;
  busy: boolean;
  fatalError: string | null;
  onSelectTask: (taskId: ConfigTaskId) => void;
  onRunTask: (taskId: ConfigTaskId, retry?: boolean) => Promise<void>;
  onRefreshSnapshot: () => Promise<void>;
}

interface TaskStatusView {
  ready: boolean;
  label: string;
  badgeVariant: 'success' | 'warning' | 'accent';
  dotStatus: BreathingStatus;
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'keychain':
      return 'Keychain';
    case 'env':
      return 'Environment';
    case 'dotenv':
      return '.env';
    case 'none':
      return 'Not configured';
    default:
      return source;
  }
}

function getTaskStatus(snapshot: SetupSnapshot, taskId: ConfigTaskId): TaskStatusView {
  switch (taskId) {
    case 'claude_auth':
      return snapshot.claudeCredential.configured
        ? {
          ready: true,
          label: `Configured via ${getSourceLabel(snapshot.claudeCredential.source)}`,
          badgeVariant: 'success',
          dotStatus: 'ready',
        }
        : {
          ready: false,
          label: 'Credential missing',
          badgeVariant: 'warning',
          dotStatus: 'missing',
        };
    case 'discord_auth':
      return snapshot.discordBotToken.configured
        ? {
          ready: true,
          label: `Configured via ${getSourceLabel(snapshot.discordBotToken.source)}`,
          badgeVariant: 'success',
          dotStatus: 'ready',
        }
        : {
          ready: false,
          label: 'Bot token missing',
          badgeVariant: 'warning',
          dotStatus: 'missing',
        };
    case 'register_main_channel':
      return snapshot.registeredMainChannel.configured
        ? {
          ready: true,
          label: `Channel ${snapshot.registeredMainChannel.name || 'main'} ready`,
          badgeVariant: 'success',
          dotStatus: 'ready',
        }
        : {
          ready: false,
          label: 'No channel registered',
          badgeVariant: 'warning',
          dotStatus: 'missing',
        };
    case 'mount_allowlist':
      return snapshot.mountAllowlistExists
        ? {
          ready: true,
          label: 'Allowlist file detected',
          badgeVariant: 'success',
          dotStatus: 'ready',
        }
        : {
          ready: false,
          label: 'Optional, not configured',
          badgeVariant: 'accent',
          dotStatus: 'missing',
        };
    case 'assistant_name':
      return snapshot.assistantName
        ? {
          ready: true,
          label: `Current: ${snapshot.assistantName}`,
          badgeVariant: 'success',
          dotStatus: 'ready',
        }
        : {
          ready: false,
          label: 'Using default Andy',
          badgeVariant: 'accent',
          dotStatus: 'checking',
        };
    case 'launchd_setup':
      if (snapshot.launchdLoaded) {
        return {
          ready: true,
          label: 'Service loaded',
          badgeVariant: 'success',
          dotStatus: 'ready',
        };
      }
      if (snapshot.launchdConfigured) {
        return {
          ready: false,
          label: 'Configured, not loaded',
          badgeVariant: 'accent',
          dotStatus: 'checking',
        };
      }
      return {
        ready: false,
        label: 'Optional, not configured',
        badgeVariant: 'accent',
        dotStatus: 'missing',
      };
    default:
      return {
        ready: false,
        label: 'Pending',
        badgeVariant: 'warning',
        dotStatus: 'missing',
      };
  }
}

function renderTaskForm(
  taskId: ConfigTaskId,
  draft: StepDraft,
  snapshot: SetupSnapshot,
  setDraft: Dispatch<SetStateAction<StepDraft>>,
): JSX.Element {
  if (taskId === 'claude_auth') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="claude-method">Authentication Method</Label>
          <Select
            id="claude-method"
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                claudeAuthMethod: event.target.value as StepDraft['claudeAuthMethod'],
              }))
            }
            value={draft.claudeAuthMethod}
          >
            <option value="oauth">Claude subscription token</option>
            <option value="api_key">Anthropic API key</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="claude-token">Token</Label>
          <Input
            id="claude-token"
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, claudeToken: event.target.value }))
            }
            placeholder={
              draft.claudeAuthMethod === 'oauth'
                ? 'sk-ant-oat01-...'
                : 'sk-ant-api03-...'
            }
            type="password"
            value={draft.claudeToken}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to keep existing credential from{' '}
            {getSourceLabel(snapshot.claudeCredential.source)}.
          </p>
        </div>
      </div>
    );
  }

  if (taskId === 'discord_auth') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="discord-token">Bot Token</Label>
          <Input
            id="discord-token"
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, discordBotToken: event.target.value }))
            }
            placeholder="Paste bot token"
            type="password"
            value={draft.discordBotToken}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to keep existing token from{' '}
            {getSourceLabel(snapshot.discordBotToken.source)}.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="discord-app-id">Discord App ID (optional)</Label>
          <Input
            id="discord-app-id"
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, discordAppId: event.target.value }))
            }
            placeholder="123456789012345678"
            value={draft.discordAppId}
          />
        </div>
      </div>
    );
  }

  if (taskId === 'register_main_channel') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="channel-id">Channel ID</Label>
          <Input
            id="channel-id"
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, mainChannelId: event.target.value }))
            }
            placeholder="Leave blank to auto-detect latest"
            value={draft.mainChannelId}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Group Name</Label>
            <Input
              id="channel-name"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, mainChannelName: event.target.value }))
              }
              value={draft.mainChannelName}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel-folder">Folder Name</Label>
            <Input
              id="channel-folder"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, mainChannelFolder: event.target.value }))
              }
              value={draft.mainChannelFolder}
            />
          </div>
        </div>
      </div>
    );
  }

  if (taskId === 'mount_allowlist') {
    return (
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={draft.mountNonMainReadOnly}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                mountNonMainReadOnly: event.target.checked,
              }))
            }
          />
          Force non-main groups as read-only
        </label>
        <div className="space-y-3">
          {draft.mountRoots.map((root, index) => (
            <div
              key={`${root.path}-${index}`}
              className="space-y-2 rounded-xl border border-border/75 bg-background/35 p-3"
            >
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  onChange={(event) =>
                    setDraft((prev) => {
                      const next = [...prev.mountRoots];
                      next[index] = { ...next[index], path: event.target.value };
                      return { ...prev, mountRoots: next };
                    })
                  }
                  placeholder="~/projects"
                  value={root.path}
                />
                <Input
                  onChange={(event) =>
                    setDraft((prev) => {
                      const next = [...prev.mountRoots];
                      next[index] = { ...next[index], description: event.target.value };
                      return { ...prev, mountRoots: next };
                    })
                  }
                  placeholder="Description"
                  value={root.description}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
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
                Read-write access
              </label>
            </div>
          ))}
        </div>
        <Button
          onClick={() =>
            setDraft((prev) => ({
              ...prev,
              mountRoots: [
                ...prev.mountRoots,
                { path: '', description: '', allowReadWrite: false },
              ],
            }))
          }
          size="sm"
          variant="secondary"
        >
          Add Root
        </Button>
      </div>
    );
  }

  if (taskId === 'assistant_name') {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="assistant-name">Assistant Name</Label>
          <Input
            id="assistant-name"
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, assistantName: event.target.value }))
            }
            placeholder="Andy"
            value={draft.assistantName}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Trigger preview: @{draft.assistantName || 'Andy'} hello
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        Launchd setup is optional. Configure it when you need NanoClaw running in the
        background after login.
      </p>
      <p>This action generates launch script + plist and loads the service.</p>
    </div>
  );
}

export function MainDashboardView({
  state,
  snapshot,
  logs,
  draft,
  setDraft,
  selectedTaskId,
  busy,
  fatalError,
  onSelectTask,
  onRunTask,
  onRefreshSnapshot,
}: MainDashboardViewProps): JSX.Element {
  const dependencyBadge = snapshot.canRunCore ? 'success' : 'warning';
  const selectedRuntime = state.steps[selectedTaskId];
  const selectedStatus = getTaskStatus(snapshot, selectedTaskId);

  return (
    <div className="tech-shell">
      <header className="glass-panel animate-rise-in p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-accent">
              NanoClaw Dashboard
            </p>
            <h1 className="mt-2 text-3xl leading-tight text-foreground md:text-4xl">
              Post-Setup Configuration Center
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground md:text-base">
              Setup is done. Configure integrations and optional capabilities from task
              cards without blocking core dependency readiness.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={dependencyBadge}>
              {snapshot.canRunCore ? 'Dependencies Ready' : 'Dependency Drift'}
            </Badge>
            <Button onClick={onRefreshSnapshot} size="sm" variant="secondary">
              Refresh Dependencies
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>Last check: {snapshot.generatedAt}</span>
          <span className="text-border">|</span>
          <span>
            Missing:{' '}
            {snapshot.missingCoreItems.length > 0
              ? snapshot.missingCoreItems.join(', ')
              : 'none'}
          </span>
        </div>
      </header>

      {fatalError ? (
        <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-rose-200">
          {fatalError}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_1fr]">
        <Card className="animate-rise-in [animation-delay:80ms]">
          <CardHeader>
            <CardTitle>Configuration Task Cards</CardTitle>
            <CardDescription>
              Run any card independently. Failures affect only that task.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {CONFIG_TASKS.map((task) => {
              const status = getTaskStatus(snapshot, task.id);
              const active = selectedTaskId === task.id;
              return (
                <button
                  key={task.id}
                  className={cn(
                    'rounded-xl border p-4 text-left transition',
                    active
                      ? 'border-cyan-300/70 bg-muted/70'
                      : 'border-border/80 bg-background/45 hover:border-cyan-400/45',
                  )}
                  onClick={() => onSelectTask(task.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusBreathingDot status={status.dotStatus} />
                      <p className="font-heading text-lg text-foreground">{task.title}</p>
                    </div>
                    <Badge variant={status.badgeVariant}>
                      {status.ready ? 'Ready' : 'Pending'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{task.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{status.label}</p>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="animate-rise-in [animation-delay:120ms]">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>
                  {CONFIG_TASKS.find((task) => task.id === selectedTaskId)?.title}
                </CardTitle>
                <CardDescription>
                  {CONFIG_TASKS.find((task) => task.id === selectedTaskId)?.summary}
                </CardDescription>
              </div>
              <Badge variant={selectedStatus.badgeVariant}>{selectedStatus.label}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderTaskForm(selectedTaskId, draft, snapshot, setDraft)}
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => onRunTask(selectedTaskId, false)}>
                {busy ? 'Running...' : 'Run Task'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => onRunTask(selectedTaskId, true)}
                variant="secondary"
              >
                Retry Task
              </Button>
            </div>

            {selectedRuntime.blockedReason ? (
              <div className="rounded-xl border border-warning/45 bg-warning/10 p-4">
                <p className="text-sm font-semibold text-warning-foreground">
                  {selectedRuntime.blockedReason}
                </p>
                {selectedRuntime.manualCheckpoints.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-warning-foreground">
                    {selectedRuntime.manualCheckpoints.map((checkpoint) => (
                      <li key={checkpoint.id}>{checkpoint.title}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="animate-rise-in [animation-delay:160ms]">
        <CardHeader>
          <CardTitle>Execution Log</CardTitle>
          <CardDescription>Shared logs for setup and dashboard actions.</CardDescription>
        </CardHeader>
        <CardContent>
          <details className="group rounded-xl border border-border/75 bg-background/45 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              Toggle logs ({logs.length})
            </summary>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-2">
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No logs yet.</p>
              ) : (
                logs
                  .slice()
                  .reverse()
                  .slice(0, 100)
                  .map((entry) => (
                    <article
                      key={`${entry.timestamp}-${entry.message}`}
                      className="rounded-lg border border-border/80 bg-card/45 px-3 py-2"
                    >
                      <p className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{entry.timestamp}</span>
                        <span className="uppercase tracking-[0.1em]">{entry.stepId}</span>
                      </p>
                      <p className="mt-1 text-sm text-foreground">{entry.message}</p>
                    </article>
                  ))
              )}
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

export { type ConfigTaskId };
