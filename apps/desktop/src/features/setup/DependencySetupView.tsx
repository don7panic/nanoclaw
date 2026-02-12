import {
  type SetupLogEntry,
  type SetupManualActionEvent,
  type SetupSnapshot,
  type SetupState,
  type SetupStepId,
  type StepStatus,
} from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBreathingDot, type BreathingStatus } from '@/features/common/StatusBreathingDot';
import { cn } from '@/lib/utils';

const DEPENDENCY_STEPS: Array<{
  id: SetupStepId;
  title: string;
  summary: string;
}> = [
    {
      id: 'preflight',
      title: 'Preflight',
      summary: 'Host tools and permissions',
    },
    {
      id: 'install_dependencies',
      title: 'Packages',
      summary: 'Workspace npm dependencies',
    },
    {
      id: 'container_runtime',
      title: 'Runtime',
      summary: 'Apple Container availability',
    },
    {
      id: 'build_agent_image',
      title: 'Image',
      summary: 'nanoclaw-agent build check',
    },
  ];

const DEPENDENCY_MATRIX = [
  {
    key: 'node',
    label: 'Node.js 20+',
    describe: 'Runtime for NanoClaw service',
    from: (snapshot: SetupSnapshot) => snapshot.dependencies.node,
  },
  {
    key: 'npm',
    label: 'npm',
    describe: 'Dependency manager in PATH',
    from: (snapshot: SetupSnapshot) => snapshot.dependencies.npm,
  },
  {
    key: 'claude',
    label: 'Claude CLI',
    describe: 'Local Claude binary detected',
    from: (snapshot: SetupSnapshot) => snapshot.dependencies.claude,
  },
  {
    key: 'repoWritable',
    label: 'Repo Writable',
    describe: 'Current workspace has write access',
    from: (snapshot: SetupSnapshot) => snapshot.dependencies.repoWritable,
  },
  {
    key: 'workspaceDepsReady',
    label: 'Workspace Packages',
    describe: 'node_modules prepared',
    from: (snapshot: SetupSnapshot) => snapshot.dependencies.workspaceDepsReady,
  },
  {
    key: 'appleContainer',
    label: 'Apple Container',
    describe: 'container CLI installed',
    from: (snapshot: SetupSnapshot) => snapshot.dependencies.appleContainer,
  },
  {
    key: 'containerSystemRunning',
    label: 'Container System',
    describe: 'container system is running',
    from: (snapshot: SetupSnapshot) => snapshot.dependencies.containerSystemRunning,
  },
  {
    key: 'imageBuilt',
    label: 'Agent Image',
    describe: 'nanoclaw-agent image is available',
    from: (snapshot: SetupSnapshot) => snapshot.imageBuilt,
  },
];

interface DependencySetupViewProps {
  state: SetupState;
  snapshot: SetupSnapshot;
  logs: SetupLogEntry[];
  selectedStepId: SetupStepId;
  fatalError: string | null;
  busy: boolean;
  setupComplete: boolean;
  lastManualAction: SetupManualActionEvent | null;
  onSelectStep: (stepId: SetupStepId) => void;
  onRunGuidedSetup: () => Promise<void>;
  onRunSelectedStep: (retry?: boolean) => Promise<void>;
  onCancelSetup: () => Promise<void>;
  onMarkCheckpoint: (checkpointId: string) => Promise<void>;
  onOpenDashboard: () => void;
}

function getStepBadge(status: StepStatus): { text: string; variant: 'accent' | 'success' | 'warning' | 'danger' } {
  switch (status) {
    case 'running':
      return { text: 'Running', variant: 'accent' };
    case 'done':
      return { text: 'Done', variant: 'success' };
    case 'blocked':
      return { text: 'Manual Action', variant: 'warning' };
    case 'failed':
      return { text: 'Failed', variant: 'danger' };
    case 'cancelled':
      return { text: 'Cancelled', variant: 'danger' };
    default:
      return { text: 'Pending', variant: 'warning' };
  }
}

function mapStepStatusToDot(status: StepStatus, active: boolean): BreathingStatus {
  if (status === 'done') return 'ready';
  if (status === 'running') return 'running';
  if (status === 'failed' || status === 'cancelled') return 'error';
  if (status === 'blocked') return 'missing';
  return active ? 'checking' : 'missing';
}

export function DependencySetupView({
  state,
  snapshot,
  logs,
  selectedStepId,
  fatalError,
  busy,
  setupComplete,
  lastManualAction,
  onSelectStep,
  onRunGuidedSetup,
  onRunSelectedStep,
  onCancelSetup,
  onMarkCheckpoint,
  onOpenDashboard,
}: DependencySetupViewProps): JSX.Element {
  const doneCount = DEPENDENCY_STEPS.filter(
    (step) => state.steps[step.id].status === 'done',
  ).length;
  const progress = (doneCount / DEPENDENCY_STEPS.length) * 100;
  const selectedRuntime = state.steps[selectedStepId];
  const selectedBadge = getStepBadge(selectedRuntime.status);

  return (
    <div className="tech-shell">
      <header className="glass-panel animate-rise-in p-6 md:p-7">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">
          NanoClaw Desktop Setup
        </p>
        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl leading-tight text-foreground md:text-4xl">
              Minimal Tech Onboarding
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
              Setup focuses on dependency readiness only. Discord channel, mount
              project, and optional service configuration move to the main dashboard.
            </p>
          </div>
          <Badge variant={setupComplete ? 'success' : 'warning'}>
            {setupComplete ? 'Dependencies Ready' : 'Setup Required'}
          </Badge>
        </div>
      </header>

      <Card className="animate-rise-in [animation-delay:80ms]">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Horizontal Setup Guide</CardTitle>
              <CardDescription>
                Auto-detect passing checks and only execute missing dependency steps.
              </CardDescription>
            </div>
            <Badge variant={selectedBadge.variant}>{selectedBadge.text}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <Progress value={progress} />
          <ol className="grid gap-3 md:grid-cols-4">
            {DEPENDENCY_STEPS.map((step) => {
              const runtime = state.steps[step.id];
              const badge = getStepBadge(runtime.status);
              const active = selectedStepId === step.id;
              return (
                <li key={step.id}>
                  <button
                    className={cn(
                      'group h-full w-full rounded-xl border px-4 py-3 text-left transition hover:border-cyan-300/65 hover:bg-muted/65',
                      active
                        ? 'border-cyan-300/75 bg-muted/80'
                        : 'border-border/80 bg-background/50',
                    )}
                    onClick={() => onSelectStep(step.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusBreathingDot
                        status={mapStepStatusToDot(runtime.status as StepStatus, active)}
                      />
                      <span className="text-xs uppercase tracking-[0.11em] text-muted-foreground">
                        {badge.text}
                      </span>
                    </div>
                    <p className="mt-2 font-heading text-lg text-foreground">{step.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{step.summary}</p>
                  </button>
                </li>
              );
            })}
          </ol>

          {fatalError ? (
            <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-rose-200">
              {fatalError}
            </div>
          ) : null}

          {lastManualAction && lastManualAction.stepId === selectedStepId ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
              <p className="font-semibold text-warning-foreground">Manual action required</p>
              <p className="mt-1 text-sm text-warning-foreground/90">
                {lastManualAction.reason}
              </p>
            </div>
          ) : null}

          {selectedRuntime.blockedReason ? (
            <div className="rounded-xl border border-warning/45 bg-warning/10 p-4">
              <p className="text-sm font-semibold text-warning-foreground">
                {selectedRuntime.blockedReason}
              </p>
              <div className="mt-3 space-y-3">
                {selectedRuntime.manualCheckpoints.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="rounded-lg border border-warning/40 bg-background/40 p-3"
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {checkpoint.title}
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {checkpoint.instructions.map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                      ))}
                    </ul>
                    <Button
                      className="mt-3"
                      disabled={busy || checkpoint.completed}
                      onClick={() => onMarkCheckpoint(checkpoint.id)}
                      size="sm"
                      variant="secondary"
                    >
                      {checkpoint.completed ? 'Acknowledged' : 'Mark Completed'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={onRunGuidedSetup}>
              {busy ? 'Running setup...' : 'Start / Continue Setup'}
            </Button>
            <Button
              disabled={busy}
              onClick={() => onRunSelectedStep(false)}
              variant="secondary"
            >
              Run Selected Step
            </Button>
            <Button
              disabled={busy}
              onClick={() => onRunSelectedStep(true)}
              variant="secondary"
            >
              Retry Selected Step
            </Button>
            <Button disabled={busy} onClick={onCancelSetup} variant="ghost">
              Cancel Setup
            </Button>
            <Button disabled={!setupComplete} onClick={onOpenDashboard} variant="ghost">
              Open Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="animate-rise-in [animation-delay:130ms]">
        <CardHeader>
          <CardTitle>Dependency Status Matrix</CardTitle>
          <CardDescription>
            Breathing indicators show pass/fail status with live setup feedback.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DEPENDENCY_MATRIX.map((dep) => {
            const ready = dep.from(snapshot);
            const status: BreathingStatus = ready
              ? 'ready'
              : fatalError
                ? 'error'
                : busy
                  ? 'checking'
                  : 'missing';
            return (
              <div
                key={dep.key}
                className={cn(
                  'rounded-xl border p-3',
                  ready ? 'border-success/45 bg-success/10' : 'border-border bg-muted/25',
                )}
              >
                <div className="flex items-center gap-2">
                  <StatusBreathingDot status={status} />
                  <p className="text-sm font-semibold text-foreground">{dep.label}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{dep.describe}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="animate-rise-in [animation-delay:180ms]">
        <CardHeader>
          <CardTitle>Live Setup Log</CardTitle>
          <CardDescription>Latest execution output from setup steps.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-2">
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No runtime output yet. Start setup to stream logs.
              </p>
            ) : (
              logs
                .slice()
                .reverse()
                .slice(0, 60)
                .map((entry) => (
                  <article
                    key={`${entry.timestamp}-${entry.message}`}
                    className="rounded-lg border border-border/80 bg-background/45 px-3 py-2"
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
        </CardContent>
      </Card>
    </div>
  );
}
