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
    <div className="heritage-shell">
      <header className="animate-rise-in space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
          <p className="text-xs font-medium uppercase tracking-widest text-gold/80">
            NanoClaw Desktop
          </p>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <h1 className="font-serif text-3xl text-foreground md:text-4xl">
              Setup
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Configure your NanoClaw assistant with heritage-grade precision.
              Dependency readiness ensures reliable operation.
            </p>
          </div>
          <Badge variant={setupComplete ? 'success' : 'warning'}>
            {setupComplete ? 'Ready' : 'Setup Required'}
          </Badge>
        </div>
      </header>

      <Card className="animate-rise-in">
        <CardHeader className="border-b border-border/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Setup Guide</CardTitle>
              <CardDescription>
                Auto-detect passing checks and execute missing dependencies.
              </CardDescription>
            </div>
            <Badge variant={selectedBadge.variant}>{selectedBadge.text}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <Progress value={progress} />
          <ol className="grid gap-4 md:grid-cols-4">
            {DEPENDENCY_STEPS.map((step) => {
              const runtime = state.steps[step.id];
              const badge = getStepBadge(runtime.status);
              const active = selectedStepId === step.id;
              return (
                <li key={step.id}>
                  <button
                    className={cn(
                      'group h-full w-full rounded-lg border px-4 py-4 text-left transition-all duration-200',
                      'hover:border-gold/40 hover:bg-muted/30 hover:shadow-sm',
                      active
                        ? 'border-gold/60 bg-muted/50 shadow-sm'
                        : 'border-border bg-card',
                    )}
                    onClick={() => onSelectStep(step.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusBreathingDot
                        status={mapStepStatusToDot(runtime.status as StepStatus, active)}
                      />
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {badge.text}
                      </span>
                    </div>
                    <p className="mt-3 font-serif text-base text-foreground">{step.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground/80">{step.summary}</p>
                  </button>
                </li>
              );
            })}
          </ol>

          {fatalError ? (
            <div className="rounded-lg border border-burgundy/40 bg-burgundy/10 px-4 py-3 text-sm text-burgundy">
              {fatalError}
            </div>
          ) : null}

          {lastManualAction && lastManualAction.stepId === selectedStepId ? (
            <div className="rounded-lg border border-gold/40 bg-gold/10 p-4">
              <p className="font-medium text-foreground">Manual Action Required</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {lastManualAction.reason}
              </p>
            </div>
          ) : null}

          {selectedRuntime.blockedReason ? (
            <div className="rounded-lg border border-gold/40 bg-gold/10 p-4">
              <p className="text-sm font-medium text-foreground">
                {selectedRuntime.blockedReason}
              </p>
              <div className="mt-4 space-y-3">
                {selectedRuntime.manualCheckpoints.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="rounded-lg border border-border bg-card p-4"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {checkpoint.title}
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {checkpoint.instructions.map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                      ))}
                    </ul>
                    <Button
                      className="mt-4"
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

          <div className="flex flex-wrap gap-3 pt-2">
            <Button disabled={busy} onClick={onRunGuidedSetup}>
              {busy ? 'Running setup...' : 'Start Setup'}
            </Button>
            <Button
              disabled={busy}
              onClick={() => onRunSelectedStep(false)}
              variant="secondary"
            >
              Run Selected
            </Button>
            <Button
              disabled={busy}
              onClick={() => onRunSelectedStep(true)}
              variant="secondary"
            >
              Retry
            </Button>
            <Button disabled={busy} onClick={onCancelSetup} variant="ghost">
              Cancel
            </Button>
            <Button disabled={!setupComplete} onClick={onOpenDashboard} variant="outline">
              Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="animate-rise-in ">
        <CardHeader className="border-b border-border/50">
          <CardTitle>Dependency Status</CardTitle>
          <CardDescription>
            System readiness indicators with live feedback.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
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
                  'rounded-lg border p-4 transition-colors',
                  ready ? 'border-forest/30 bg-forest/5' : 'border-border bg-card',
                )}
              >
                <div className="flex items-center gap-3">
                  <StatusBreathingDot status={status} />
                  <p className="text-sm font-medium text-foreground">{dep.label}</p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{dep.describe}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="animate-rise-in ">
        <CardHeader className="border-b border-border/50">
          <CardTitle>Setup Log</CardTitle>
          <CardDescription>Execution output from setup steps.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="max-h-64 space-y-3 overflow-y-auto pr-2 font-mono text-sm">
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No runtime output yet. Start setup to stream logs.
              </p>
            ) : (
              logs
                .slice()
                .reverse()
                .slice(0, 60)
                .map((entry, index) => (
                  <article
                    key={`${entry.timestamp}-${index}-${entry.message}`}
                    className="rounded border border-border/50 bg-muted/30 px-4 py-3"
                  >
                    <p className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">{entry.timestamp}</span>
                      <span className="text-xs font-medium uppercase tracking-wider text-gold/70">{entry.stepId}</span>
                    </p>
                    <p className="mt-2 text-sm text-foreground">{entry.message}</p>
                  </article>
                ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
