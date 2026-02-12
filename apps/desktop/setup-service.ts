import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

type SetupEventName =
  | 'setup://log'
  | 'setup://step-status'
  | 'setup://requires-user-action'
  | 'setup://fatal-error';

const KEYCHAIN_SERVICE = 'nanoclaw.setup';
const STATE_VERSION = 1;

const STEP_ORDER = [
  'preflight',
  'install_dependencies',
  'container_runtime',
  'claude_auth',
  'build_agent_image',
  'discord_auth',
  'assistant_name',
  'security_confirmation',
  'register_main_channel',
  'mount_allowlist',
  'launchd_setup',
  'final_test',
] as const;

type SetupStepId = (typeof STEP_ORDER)[number];
type StepStatus =
  | 'idle'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'done'
  | 'cancelled';
type LogLevel = 'info' | 'warning' | 'error';

interface ManualCheckpoint {
  id: string;
  title: string;
  instructions: string[];
  severity: 'info' | 'warning' | 'error';
  skippable: boolean;
  completed: boolean;
}

interface SetupStepRuntime {
  id: SetupStepId;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  blockedReason: string | null;
  retryCount: number;
  manualCheckpoints: ManualCheckpoint[];
}

interface SetupState {
  version: number;
  createdAt: string;
  updatedAt: string;
  currentStep: SetupStepId;
  selectedRuntime: 'apple_container' | 'docker' | null;
  steps: Record<SetupStepId, SetupStepRuntime>;
  cancelled: boolean;
  stepPayloads: Record<string, unknown>;
}

interface SetupCredentialSnapshot {
  configured: boolean;
  source: string;
}

interface SetupClaudeCredentialSnapshot extends SetupCredentialSnapshot {
  method: 'oauth' | 'api_key' | 'auth_token' | null;
}

interface SetupDependenciesSnapshot {
  node: boolean;
  npm: boolean;
  claude: boolean;
  workspaceDepsReady: boolean;
  appleContainer: boolean;
  containerSystemRunning: boolean;
  repoWritable: boolean;
}

interface SetupMainChannelSnapshot {
  configured: boolean;
  channelId: string | null;
  name: string | null;
  folder: string | null;
  trigger: string | null;
}

interface SetupSnapshot {
  generatedAt: string;
  dependencies: SetupDependenciesSnapshot;
  claudeCredential: SetupClaudeCredentialSnapshot;
  discordBotToken: SetupCredentialSnapshot;
  discordAppId: SetupCredentialSnapshot;
  assistantName: string | null;
  assistantNameSource: string;
  runtime: string;
  runtimeReady: boolean;
  imageBuilt: boolean;
  mountAllowlistExists: boolean;
  mountAllowlistPath: string;
  launchdConfigured: boolean;
  launchdLoaded: boolean;
  registeredMainChannel: SetupMainChannelSnapshot;
  canRunCore: boolean;
  missingCoreItems: string[];
}

interface SetupLogEntry {
  timestamp: string;
  stepId: SetupStepId | 'system';
  level: LogLevel;
  message: string;
}

interface SetupReport {
  generatedAt: string;
  success: boolean;
  steps: Array<{
    id: SetupStepId;
    status: StepStatus;
    notes: string[];
  }>;
  logs: SetupLogEntry[];
}

interface StartStepPayload {
  stepId: SetupStepId;
  data?: Record<string, unknown> | null;
}

interface RetryStepPayload {
  stepId: SetupStepId;
}

interface SkipManualCheckPayload {
  stepId: SetupStepId;
  checkpointId: string;
}

interface ManualActionEvent {
  stepId: SetupStepId;
  reason: string;
  checkpoints: ManualCheckpoint[];
}

interface DetectedValue {
  value: string | null;
  source: string;
}

interface DetectedClaudeCredential {
  configured: boolean;
  source: string;
  method: SetupClaudeCredentialSnapshot['method'];
}

interface StepResult {
  status: StepStatus;
  nextStep: SetupStepId | null;
  selectedRuntime: SetupState['selectedRuntime'];
  blockedReason: string | null;
  checkpoints: ManualCheckpoint[];
  notes: string[];
  logs: SetupLogEntry[];
}

interface ShellResult {
  logs: SetupLogEntry[];
  error: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isSetupStepId(stepId: string): stepId is SetupStepId {
  return (STEP_ORDER as readonly string[]).includes(stepId);
}

function findRepoRoot(startDir: string): string {
  let cursor = path.resolve(startDir);

  while (true) {
    const markerGit = path.join(cursor, '.git');
    const markerSrc = path.join(cursor, 'src/index.ts');
    const markerPackage = path.join(cursor, 'package.json');

    if (
      fs.existsSync(markerGit) &&
      fs.existsSync(markerSrc) &&
      fs.existsSync(markerPackage)
    ) {
      return cursor;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  throw new Error('Failed to locate NanoClaw repository root');
}

function nextStepOf(stepId: SetupStepId): SetupStepId | null {
  const index = STEP_ORDER.indexOf(stepId);
  if (index < 0 || index + 1 >= STEP_ORDER.length) {
    return null;
  }
  return STEP_ORDER[index + 1];
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

function createInitialState(): SetupState {
  const steps = {} as Record<SetupStepId, SetupStepRuntime>;
  for (const stepId of STEP_ORDER) {
    steps[stepId] = createRuntime(stepId);
  }

  const timestamp = nowIso();
  return {
    version: STATE_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentStep: 'preflight',
    selectedRuntime: null,
    steps,
    cancelled: false,
    stepPayloads: {},
  };
}

function makeLog(
  stepId: SetupStepId | 'system',
  level: LogLevel,
  message: string,
): SetupLogEntry {
  return {
    timestamp: nowIso(),
    stepId,
    level,
    message,
  };
}

function logHasMarker(logs: SetupLogEntry[], marker: string): boolean {
  return logs.some((entry) => {
    const message = entry.message.trim();
    return message === marker || message.startsWith(`${marker} `);
  });
}

function parseDotenv(repoRoot: string): Record<string, string> {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) {
    return {};
  }

  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value) {
      values[key] = value;
    }
  }

  return values;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class SetupService extends EventEmitter {
  private readonly repoRoot: string;
  private readonly statePath: string;
  private readonly reportPath: string;

  private state: SetupState;
  private logs: SetupLogEntry[];
  private queue: Promise<unknown>;

  constructor(startDir: string) {
    super();

    this.repoRoot = findRepoRoot(startDir);
    this.statePath = path.join(this.repoRoot, 'data/setup-wizard/state.json');
    this.reportPath = path.join(this.repoRoot, 'data/setup-wizard/report.json');
    this.logs = [];
    this.queue = Promise.resolve();

    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    this.state = this.loadState();
  }

  getState(): SetupState {
    return structuredClone(this.state);
  }

  getSnapshot(): SetupSnapshot {
    return this.detectSetupSnapshot(this.state);
  }

  async startStep(payload: StartStepPayload): Promise<SetupState> {
    return this.enqueue(() => this.runStep(payload.stepId, payload.data ?? null, false));
  }

  async retryStep(payload: RetryStepPayload): Promise<SetupState> {
    return this.enqueue(() => {
      const retryPayload = this.state.stepPayloads[payload.stepId] ?? null;
      return this.runStep(payload.stepId, retryPayload, true);
    });
  }

  async skipManualCheck(payload: SkipManualCheckPayload): Promise<SetupState> {
    return this.enqueue(async () => {
      const runtime = this.state.steps[payload.stepId];
      if (runtime) {
        runtime.manualCheckpoints = runtime.manualCheckpoints.map((checkpoint) =>
          checkpoint.id === payload.checkpointId
            ? { ...checkpoint, completed: true }
            : checkpoint,
        );

        const allCompleted = runtime.manualCheckpoints.every(
          (checkpoint) => checkpoint.completed || checkpoint.skippable,
        );

        if (allCompleted && runtime.status === 'blocked') {
          runtime.status = 'idle';
          runtime.blockedReason = null;
        }
      }

      this.state.updatedAt = nowIso();
      this.persistState();
      this.persistReport();
      this.emitState();

      return this.getState();
    });
  }

  async cancel(): Promise<SetupState> {
    return this.enqueue(async () => {
      this.state.cancelled = true;
      this.state.updatedAt = nowIso();

      const currentStep = this.state.currentStep;
      const runtime = this.state.steps[currentStep];
      if (runtime) {
        runtime.status = 'cancelled';
        runtime.finishedAt = nowIso();
      }

      this.persistState();
      this.persistReport();

      const entry = makeLog('system', 'warning', 'Setup cancelled by user.');
      this.appendLogs([entry]);
      this.emitLog(entry);
      this.emitState();

      return this.getState();
    });
  }

  private loadState(): SetupState {
    if (!fs.existsSync(this.statePath)) {
      return createInitialState();
    }

    try {
      const content = fs.readFileSync(this.statePath, 'utf8');
      const parsed = JSON.parse(content) as Partial<SetupState>;

      if (!parsed || typeof parsed !== 'object') {
        return createInitialState();
      }

      const base = createInitialState();
      const parsedSteps = parsed.steps ?? {};

      for (const stepId of STEP_ORDER) {
        const incoming = parsedSteps[stepId] as Partial<SetupStepRuntime> | undefined;
        if (!incoming) {
          continue;
        }
        base.steps[stepId] = {
          ...base.steps[stepId],
          ...incoming,
          id: stepId,
          status: (incoming.status as StepStatus | undefined) ?? base.steps[stepId].status,
          manualCheckpoints: Array.isArray(incoming.manualCheckpoints)
            ? (incoming.manualCheckpoints as ManualCheckpoint[])
            : base.steps[stepId].manualCheckpoints,
        };
      }

      base.version = parsed.version ?? STATE_VERSION;
      base.createdAt = parsed.createdAt ?? base.createdAt;
      base.updatedAt = parsed.updatedAt ?? base.updatedAt;
      base.currentStep =
        parsed.currentStep && isSetupStepId(parsed.currentStep)
          ? parsed.currentStep
          : base.currentStep;
      base.selectedRuntime =
        parsed.selectedRuntime === 'apple_container' || parsed.selectedRuntime === 'docker'
          ? parsed.selectedRuntime
          : null;
      base.cancelled = Boolean(parsed.cancelled);
      base.stepPayloads =
        parsed.stepPayloads && typeof parsed.stepPayloads === 'object'
          ? (parsed.stepPayloads as Record<string, unknown>)
          : {};

      return base;
    } catch {
      return createInitialState();
    }
  }

  private persistState(): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
  }

  private persistReport(): void {
    const steps = STEP_ORDER.map((stepId) => {
      const runtime = this.state.steps[stepId];
      const notes: string[] = [];
      if (runtime.blockedReason) {
        notes.push(runtime.blockedReason);
      }
      if (runtime.error) {
        notes.push(runtime.error);
      }
      return {
        id: stepId,
        status: runtime.status,
        notes,
      };
    });

    const success = steps.every((step) => step.status === 'done');

    const report: SetupReport = {
      generatedAt: nowIso(),
      success,
      steps,
      logs: this.logs,
    };

    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    fs.writeFileSync(this.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  private appendLogs(entries: SetupLogEntry[]): void {
    for (const entry of entries) {
      this.logs.push(entry);
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private emitLog(entry: SetupLogEntry): void {
    this.emit('setup://log', entry);
  }

  private emitState(): void {
    this.emit('setup://step-status', this.getState());
  }

  private emitManualAction(event: ManualActionEvent): void {
    this.emit('setup://requires-user-action', event);
  }

  private emitFatalError(message: string): void {
    this.emit('setup://fatal-error', { message });
  }

  private setStepRunning(stepId: SetupStepId, retry: boolean): void {
    const timestamp = nowIso();
    this.state.updatedAt = timestamp;
    this.state.currentStep = stepId;

    const runtime = this.state.steps[stepId];
    runtime.status = 'running';
    runtime.startedAt = runtime.startedAt ?? timestamp;
    runtime.finishedAt = null;
    runtime.error = null;
    runtime.blockedReason = null;
    runtime.manualCheckpoints = [];
    if (retry) {
      runtime.retryCount += 1;
    }
  }

  private finalizeStep(stepId: SetupStepId, result: StepResult): void {
    const timestamp = nowIso();
    this.state.updatedAt = timestamp;

    const runtime = this.state.steps[stepId];
    runtime.status = result.status;
    runtime.finishedAt = timestamp;
    runtime.error = null;
    runtime.blockedReason = result.blockedReason;
    runtime.manualCheckpoints = result.checkpoints;

    if (result.selectedRuntime) {
      this.state.selectedRuntime = result.selectedRuntime;
    }

    if (result.status === 'done' && result.nextStep) {
      this.state.currentStep = result.nextStep;
    } else {
      this.state.currentStep = stepId;
    }
  }

  private failStep(stepId: SetupStepId, message: string): void {
    const timestamp = nowIso();
    this.state.updatedAt = timestamp;
    this.state.currentStep = stepId;

    const runtime = this.state.steps[stepId];
    runtime.status = 'failed';
    runtime.finishedAt = timestamp;
    runtime.error = message;
    runtime.blockedReason = null;
  }

  private async runStep(
    stepId: SetupStepId,
    payload: unknown,
    retry: boolean,
  ): Promise<SetupState> {
    this.state.cancelled = false;
    this.setStepRunning(stepId, retry);
    this.state.stepPayloads[stepId] = payload ?? null;
    this.persistState();

    const stateSnapshot = structuredClone(this.state);
    this.emitState();

    try {
      const stepResult = await this.executeStep(stepId, payload, stateSnapshot);

      this.appendLogs(stepResult.logs);
      this.finalizeStep(stepId, stepResult);

      this.persistState();
      this.persistReport();

      if (stepResult.status === 'blocked') {
        this.emitManualAction({
          stepId,
          reason: stepResult.blockedReason ?? 'Manual action required',
          checkpoints: stepResult.checkpoints,
        });
      }

      this.emitState();
      return this.getState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failStep(stepId, message);
      this.persistState();

      const entry = makeLog(stepId, 'error', message);
      this.appendLogs([entry]);
      this.persistReport();

      this.emitLog(entry);
      this.emitFatalError(message);
      this.emitState();

      return this.getState();
    }
  }

  private async executeStep(
    stepId: SetupStepId,
    payload: unknown,
    stateSnapshot: SetupState,
  ): Promise<StepResult> {
    const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

    switch (stepId) {
      case 'preflight':
        return this.runPreflight();
      case 'install_dependencies':
        return this.runInstallDependencies();
      case 'container_runtime':
        return this.runContainerRuntime(data);
      case 'claude_auth':
        return this.runClaudeAuth(data);
      case 'build_agent_image':
        return this.runBuildAgentImage(stateSnapshot);
      case 'discord_auth':
        return this.runDiscordAuth(data);
      case 'assistant_name':
        return this.runAssistantName(data);
      case 'security_confirmation':
        return this.runSecurityConfirmation(data);
      case 'register_main_channel':
        return this.runRegisterMainChannel(data);
      case 'mount_allowlist':
        return this.runMountAllowlist(data);
      case 'launchd_setup':
        return this.runLaunchdSetup();
      case 'final_test':
        return this.runFinalTest(stateSnapshot, data);
      default:
        throw new Error(`Unknown setup step: ${stepId}`);
    }
  }

  private runShellStatus(
    cwd: string,
    script: string,
    envs: Array<[string, string]>,
  ): boolean {
    const status = spawnSync('/bin/zsh', ['-lc', script], {
      cwd,
      env: {
        ...process.env,
        ...Object.fromEntries(envs),
      },
      stdio: 'ignore',
    });

    return status.status === 0;
  }

  private commandExists(binary: string): boolean {
    return this.runShellStatus(this.repoRoot, `command -v ${binary} >/dev/null 2>&1`, []);
  }

  private async collectStreamLines(
    stream: NodeJS.ReadableStream,
    stepId: SetupStepId,
    level: LogLevel,
    logs: SetupLogEntry[],
  ): Promise<void> {
    const lineReader = readline.createInterface({ input: stream });

    return new Promise((resolve) => {
      lineReader.on('line', (line) => {
        const entry = makeLog(stepId, level, line);
        this.emitLog(entry);
        logs.push(entry);
      });
      lineReader.on('close', () => {
        resolve();
      });
      lineReader.on('error', (error) => {
        const entry = makeLog(stepId, 'warning', `Stream read error: ${String(error)}`);
        this.emitLog(entry);
        logs.push(entry);
        resolve();
      });
    });
  }

  private async runShellScript(
    stepId: SetupStepId,
    cwd: string,
    script: string,
    envs: Array<[string, string]>,
  ): Promise<ShellResult> {
    const logs: SetupLogEntry[] = [];

    const commandEntry = makeLog(stepId, 'info', `$ ${script}`);
    this.emitLog(commandEntry);
    logs.push(commandEntry);

    let child;
    try {
      child = spawn('/bin/zsh', ['-lc', script], {
        cwd,
        env: {
          ...process.env,
          ...Object.fromEntries(envs),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = `Failed to spawn command: ${String(error)}`;
      const entry = makeLog(stepId, 'error', message);
      this.emitLog(entry);
      logs.push(entry);
      return {
        logs,
        error: message,
      };
    }

    const streamTasks: Promise<void>[] = [];
    if (child.stdout) {
      streamTasks.push(this.collectStreamLines(child.stdout, stepId, 'info', logs));
    }
    if (child.stderr) {
      streamTasks.push(this.collectStreamLines(child.stderr, stepId, 'warning', logs));
    }

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).catch((error) => {
      const entry = makeLog(stepId, 'error', `Failed to wait for command: ${String(error)}`);
      this.emitLog(entry);
      logs.push(entry);
      return null;
    });

    await Promise.all(streamTasks);

    if (exitCode === 0) {
      return {
        logs,
        error: null,
      };
    }

    const message = `Command failed with exit code ${exitCode ?? 'unknown'}`;
    const entry = makeLog(stepId, 'error', message);
    this.emitLog(entry);
    logs.push(entry);

    return {
      logs,
      error: message,
    };
  }

  private runShellAndCaptureStdout(
    cwd: string,
    script: string,
    envs: Array<[string, string]>,
  ): string {
    const output = spawnSync('/bin/zsh', ['-lc', script], {
      cwd,
      env: {
        ...process.env,
        ...Object.fromEntries(envs),
      },
      encoding: 'utf8',
    });

    if (output.status !== 0) {
      const stderr = typeof output.stderr === 'string' ? output.stderr.trim() : '';
      throw new Error(`Command failed: ${stderr || 'unknown error'}`);
    }

    return (typeof output.stdout === 'string' ? output.stdout : '').trim();
  }

  private setKeychainSecret(account: string, value: string): void {
    const output = spawnSync(
      'security',
      ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', account, '-w', value],
      {
        encoding: 'utf8',
      },
    );

    if (output.status !== 0) {
      throw new Error(`Failed to save ${account} in Keychain`);
    }
  }

  private getKeychainSecret(account: string): string | null {
    const output = spawnSync(
      'security',
      ['find-generic-password', '-w', '-s', KEYCHAIN_SERVICE, '-a', account],
      {
        encoding: 'utf8',
      },
    );

    if (output.status !== 0) {
      return null;
    }

    const value = (typeof output.stdout === 'string' ? output.stdout : '').trim();
    return value || null;
  }

  private detectValue(dotenv: Record<string, string>, key: string): DetectedValue {
    const fromKeychain = this.getKeychainSecret(key);
    if (fromKeychain && fromKeychain.trim()) {
      return {
        value: fromKeychain,
        source: 'keychain',
      };
    }

    const fromEnv = process.env[key];
    if (fromEnv && fromEnv.trim()) {
      return {
        value: fromEnv,
        source: 'env',
      };
    }

    const fromDotenv = dotenv[key];
    if (fromDotenv && fromDotenv.trim()) {
      return {
        value: fromDotenv,
        source: 'dotenv',
      };
    }

    return {
      value: null,
      source: 'none',
    };
  }

  private detectClaudeCredential(dotenv: Record<string, string>): DetectedClaudeCredential {
    const oauth = this.detectValue(dotenv, 'CLAUDE_CODE_OAUTH_TOKEN');
    if (oauth.value) {
      return {
        configured: true,
        source: oauth.source,
        method: 'oauth',
      };
    }

    const apiKey = this.detectValue(dotenv, 'ANTHROPIC_API_KEY');
    if (apiKey.value) {
      return {
        configured: true,
        source: apiKey.source,
        method: 'api_key',
      };
    }

    const authToken = this.detectValue(dotenv, 'ANTHROPIC_AUTH_TOKEN');
    const baseUrl = this.detectValue(dotenv, 'ANTHROPIC_BASE_URL');
    if (authToken.value && baseUrl.value) {
      return {
        configured: true,
        source: authToken.source,
        method: 'auth_token',
      };
    }

    return {
      configured: false,
      source: 'none',
      method: null,
    };
  }

  private detectRegisteredMainChannel(): SetupMainChannelSnapshot {
    const groupsPath = path.join(this.repoRoot, 'data/registered_groups.json');
    if (!fs.existsSync(groupsPath)) {
      return {
        configured: false,
        channelId: null,
        name: null,
        folder: null,
        trigger: null,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
    } catch {
      return {
        configured: false,
        channelId: null,
        name: null,
        folder: null,
        trigger: null,
      };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        configured: false,
        channelId: null,
        name: null,
        folder: null,
        trigger: null,
      };
    }

    for (const [channelId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const entry = value as Record<string, unknown>;
      if (entry.folder !== 'main') {
        continue;
      }

      return {
        configured: true,
        channelId,
        name: typeof entry.name === 'string' ? entry.name : null,
        folder: typeof entry.folder === 'string' ? entry.folder : null,
        trigger: typeof entry.trigger === 'string' ? entry.trigger : null,
      };
    }

    return {
      configured: false,
      channelId: null,
      name: null,
      folder: null,
      trigger: null,
    };
  }

  private resolveWizardRuntime(selectedRuntime: SetupState['selectedRuntime']): 'apple_container' | 'docker' {
    if (selectedRuntime === 'docker') {
      return 'apple_container';
    }
    return 'apple_container';
  }

  private collectAuthEnv(): Array<[string, string]> {
    const envs: Array<[string, string]> = [];

    for (const account of [
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'DISCORD_BOT_TOKEN',
      'DISCORD_APP_ID',
      'ASSISTANT_NAME',
    ]) {
      const value = this.getKeychainSecret(account);
      if (value) {
        envs.push([account, value]);
      }
    }

    return envs;
  }

  private detectWorkspaceDependenciesReady(): boolean {
    const nodeModules = path.join(this.repoRoot, 'node_modules');
    const packageLock = path.join(this.repoRoot, 'package-lock.json');
    return fs.existsSync(nodeModules) && fs.existsSync(packageLock);
  }

  private detectAgentImageExists(runtime: 'apple_container' | 'docker'): boolean {
    const script =
      runtime === 'docker'
        ? 'docker image inspect nanoclaw-agent:latest >/dev/null 2>&1'
        : "container image ls 2>/dev/null | grep -q 'nanoclaw-agent'";

    return this.runShellStatus(this.repoRoot, script, []);
  }

  private detectSetupSnapshot(state: SetupState): SetupSnapshot {
    const dotenv = parseDotenv(this.repoRoot);

    const dependencies: SetupDependenciesSnapshot = {
      node: this.commandExists('node'),
      npm: this.commandExists('npm'),
      claude: this.commandExists('claude'),
      workspaceDepsReady: this.detectWorkspaceDependenciesReady(),
      appleContainer: this.commandExists('container'),
      containerSystemRunning: this.runShellStatus(
        this.repoRoot,
        'container system status >/dev/null 2>&1',
        [],
      ),
      repoWritable: this.runShellStatus(this.repoRoot, 'test -w .', []),
    };

    const claudeCredential = this.detectClaudeCredential(dotenv);
    const discordBot = this.detectValue(dotenv, 'DISCORD_BOT_TOKEN');
    const discordAppId = this.detectValue(dotenv, 'DISCORD_APP_ID');
    const assistantName = this.detectValue(dotenv, 'ASSISTANT_NAME');
    const registeredMainChannel = this.detectRegisteredMainChannel();

    const runtime = 'apple_container';
    const runtimeReady = dependencies.appleContainer && dependencies.containerSystemRunning;

    const imageBuilt =
      this.detectAgentImageExists(runtime) || state.steps.build_agent_image.status === 'done';

    const home = process.env.HOME ?? '';
    const mountAllowlistPath = path.join(home, '.config/nanoclaw/mount-allowlist.json');
    const mountAllowlistExists = fs.existsSync(mountAllowlistPath);

    const plistPath = path.join(home, 'Library/LaunchAgents/com.nanoclaw.plist');
    const launchScriptPath = path.join(this.repoRoot, 'scripts/run-nanoclaw-from-keychain.sh');
    const launchdConfigured = fs.existsSync(plistPath) && fs.existsSync(launchScriptPath);
    const launchdLoaded = this.runShellStatus(
      this.repoRoot,
      'launchctl list | grep -q com.nanoclaw',
      [],
    );

    const missingCoreItems: string[] = [];
    if (!dependencies.node) {
      missingCoreItems.push('Node.js 20+');
    }
    if (!dependencies.npm) {
      missingCoreItems.push('npm');
    }
    if (!dependencies.claude) {
      missingCoreItems.push('Claude Code CLI');
    }
    if (!dependencies.workspaceDepsReady) {
      missingCoreItems.push('Workspace npm dependencies');
    }
    if (!dependencies.repoWritable) {
      missingCoreItems.push('Repository write permission');
    }
    if (!runtimeReady) {
      missingCoreItems.push('Apple Container runtime');
    }
    if (!imageBuilt) {
      missingCoreItems.push('nanoclaw-agent image');
    }

    return {
      generatedAt: nowIso(),
      dependencies,
      claudeCredential,
      discordBotToken: {
        configured: Boolean(discordBot.value),
        source: discordBot.source,
      },
      discordAppId: {
        configured: Boolean(discordAppId.value),
        source: discordAppId.source,
      },
      assistantName: assistantName.value,
      assistantNameSource: assistantName.source,
      runtime,
      runtimeReady,
      imageBuilt,
      mountAllowlistExists,
      mountAllowlistPath,
      launchdConfigured,
      launchdLoaded,
      registeredMainChannel,
      canRunCore: missingCoreItems.length === 0,
      missingCoreItems,
    };
  }

  private async runPreflight(): Promise<StepResult> {
    const notes: string[] = [];

    const { logs, error } = await this.runShellScript(
      'preflight',
      this.repoRoot,
      `
      echo "Checking Node and npm";
      if command -v node >/dev/null 2>&1; then echo "NODE_OK $(node --version)"; else echo "NODE_MISSING"; fi
      if command -v npm >/dev/null 2>&1; then echo "NPM_OK $(npm --version)"; else echo "NPM_MISSING"; fi
      if command -v claude >/dev/null 2>&1; then echo "CLAUDE_OK"; claude --version; else echo "CLAUDE_MISSING"; fi
      echo "PLATFORM $(uname -s)";
      if [ -w . ]; then echo "REPO_WRITABLE"; else echo "REPO_NOT_WRITABLE"; fi
      if curl -Is --max-time 5 https://discord.com >/dev/null 2>&1; then echo "NETWORK_HINT_OK"; else echo "NETWORK_HINT_WARN"; fi
    `,
      this.collectAuthEnv(),
    );

    if (error) {
      throw new Error(error);
    }

    const checkpoints: ManualCheckpoint[] = [];

    if (logHasMarker(logs, 'NODE_MISSING')) {
      checkpoints.push({
        id: 'install-node',
        title: 'Install Node.js 20+',
        instructions: [
          'Install Node.js from https://nodejs.org',
          'Re-open NanoClaw Desktop Setup',
        ],
        severity: 'error',
        skippable: false,
        completed: false,
      });
    }

    if (logHasMarker(logs, 'NPM_MISSING')) {
      checkpoints.push({
        id: 'install-npm',
        title: 'Install npm',
        instructions: [
          'npm should be installed with Node.js',
          'Ensure npm is available in PATH',
        ],
        severity: 'error',
        skippable: false,
        completed: false,
      });
    }

    if (logHasMarker(logs, 'CLAUDE_MISSING')) {
      checkpoints.push({
        id: 'install-claude',
        title: 'Install Claude Code CLI',
        instructions: [
          'Download Claude Code from https://claude.ai/download',
          'Confirm `claude --version` works in terminal',
        ],
        severity: 'warning',
        skippable: false,
        completed: false,
      });
    }

    if (logHasMarker(logs, 'REPO_NOT_WRITABLE')) {
      checkpoints.push({
        id: 'repo-permission',
        title: 'Repository must be writable',
        instructions: [
          'Adjust folder permissions for the NanoClaw repository',
          'Re-run preflight',
        ],
        severity: 'error',
        skippable: false,
        completed: false,
      });
    }

    if (checkpoints.length > 0) {
      return {
        status: 'blocked',
        nextStep: null,
        selectedRuntime: null,
        blockedReason: 'Preflight requires manual remediation',
        checkpoints,
        notes,
        logs,
      };
    }

    if (logHasMarker(logs, 'NETWORK_HINT_WARN')) {
      notes.push(
        'Network reachability check failed; setup can continue but external services may fail.',
      );
    }

    return {
      status: 'done',
      nextStep: nextStepOf('preflight'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes,
      logs,
    };
  }

  private async runInstallDependencies(): Promise<StepResult> {
    const { logs, error } = await this.runShellScript(
      'install_dependencies',
      this.repoRoot,
      'npm install',
      this.collectAuthEnv(),
    );

    if (error) {
      throw new Error(error);
    }

    return {
      status: 'done',
      nextStep: nextStepOf('install_dependencies'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: ['Dependencies installed.'],
      logs,
    };
  }

  private async runContainerRuntime(payload: Record<string, unknown>): Promise<StepResult> {
    const requested = typeof payload.runtime === 'string' ? payload.runtime : 'apple_container';

    const runtime: SetupState['selectedRuntime'] = 'apple_container';
    const logs: SetupLogEntry[] = [];
    const checkpoints: ManualCheckpoint[] = [];

    const hasContainer = this.commandExists('container');

    logs.push(
      makeLog(
        'container_runtime',
        'info',
        `Detected runtime support: apple_container=${String(hasContainer)}, requested=${requested}`,
      ),
    );

    if (requested === 'docker') {
      logs.push(
        makeLog(
          'container_runtime',
          'warning',
          'Docker selection is ignored in desktop wizard; using Apple Container.',
        ),
      );
    }

    if (!hasContainer) {
      checkpoints.push({
        id: 'install-apple-container',
        title: 'Install Apple Container',
        instructions: [
          'Download latest package from https://github.com/apple/container/releases',
          'Install and run `container system start`',
        ],
        severity: 'error',
        skippable: false,
        completed: false,
      });
    } else {
      const runResult = await this.runShellScript(
        'container_runtime',
        '/',
        'container system status >/dev/null 2>&1 || container system start',
        [],
      );

      logs.push(...runResult.logs);

      if (runResult.error) {
        checkpoints.push({
          id: 'start-apple-container',
          title: 'Start Apple Container',
          instructions: [
            'Run `container system start` in Terminal',
            'Then click Retry Step',
          ],
          severity: 'error',
          skippable: false,
          completed: false,
        });
      }
    }

    if (checkpoints.length > 0) {
      return {
        status: 'blocked',
        nextStep: null,
        selectedRuntime: null,
        blockedReason: 'Container runtime needs manual setup',
        checkpoints,
        notes: [],
        logs,
      };
    }

    return {
      status: 'done',
      nextStep: nextStepOf('container_runtime'),
      selectedRuntime: runtime,
      blockedReason: null,
      checkpoints: [],
      notes: ['Apple Container runtime is available and ready.'],
      logs,
    };
  }

  private async runClaudeAuth(payload: Record<string, unknown>): Promise<StepResult> {
    const method = payload.method === 'api_key' ? 'api_key' : 'oauth';
    const token = typeof payload.token === 'string' ? payload.token.trim() : '';

    if (!token) {
      const detected = this.detectClaudeCredential(parseDotenv(this.repoRoot));
      if (detected.configured) {
        return {
          status: 'done',
          nextStep: nextStepOf('claude_auth'),
          selectedRuntime: null,
          blockedReason: null,
          checkpoints: [],
          notes: [`Reused existing Claude credential from ${detected.source}.`],
          logs: [
            makeLog(
              'claude_auth',
              'info',
              `Claude credential already configured (source: ${detected.source}, method: ${detected.method ?? 'unknown'}).`,
            ),
          ],
        };
      }

      throw new Error('Claude token is required');
    }

    if (method === 'oauth' && !token.startsWith('sk-ant-oat')) {
      throw new Error('Expected Claude subscription token (sk-ant-oat...)');
    }

    if (method === 'api_key' && !token.startsWith('sk-ant-api')) {
      throw new Error('Expected Anthropic API key (sk-ant-api...)');
    }

    const account = method === 'api_key' ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN';
    this.setKeychainSecret(account, token);
    this.setKeychainSecret('CLAUDE_AUTH_METHOD', method);

    if (!this.getKeychainSecret(account)) {
      throw new Error(`Failed to verify ${account} from Keychain`);
    }

    return {
      status: 'done',
      nextStep: nextStepOf('claude_auth'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: [`Stored ${account} in Keychain service ${KEYCHAIN_SERVICE}.`],
      logs: [makeLog('claude_auth', 'info', `Saved ${account} into Keychain.`)],
    };
  }

  private async runBuildAgentImage(stateSnapshot: SetupState): Promise<StepResult> {
    const runtime = this.resolveWizardRuntime(stateSnapshot.selectedRuntime);
    const logs: SetupLogEntry[] = [];

    if (this.detectAgentImageExists(runtime)) {
      logs.push(
        makeLog(
          'build_agent_image',
          'info',
          `Detected existing nanoclaw-agent image for ${runtime}. Skipping rebuild.`,
        ),
      );

      return {
        status: 'done',
        nextStep: nextStepOf('build_agent_image'),
        selectedRuntime: null,
        blockedReason: null,
        checkpoints: [],
        notes: [`Agent image already exists for ${runtime}.`],
        logs,
      };
    }

    // Desktop wizard only supports Apple Container runtime
    const buildResult = await this.runShellScript(
      'build_agent_image',
      this.repoRoot,
      'bash ./container/build.sh',
      this.collectAuthEnv(),
    );
    logs.push(...buildResult.logs);
    if (buildResult.error) {
      throw new Error(buildResult.error);
    }

    const smokeResult = await this.runShellScript(
      'build_agent_image',
      this.repoRoot,
      "echo '{}' | container run -i --entrypoint /bin/echo nanoclaw-agent:latest \"Container OK\"",
      this.collectAuthEnv(),
    );
    logs.push(...smokeResult.logs);
    if (smokeResult.error) {
      throw new Error(smokeResult.error);
    }

    return {
      status: 'done',
      nextStep: nextStepOf('build_agent_image'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: [`Agent image built and smoke-tested with ${runtime}.`],
      logs,
    };
  }

  private async runDiscordAuth(payload: Record<string, unknown>): Promise<StepResult> {
    const token =
      typeof payload.discordBotToken === 'string' ? payload.discordBotToken.trim() : '';

    if (!token) {
      const detected = this.detectValue(parseDotenv(this.repoRoot), 'DISCORD_BOT_TOKEN');

      if (detected.value) {
        const appId =
          typeof payload.discordAppId === 'string' ? payload.discordAppId.trim() : '';
        if (appId) {
          this.setKeychainSecret('DISCORD_APP_ID', appId);
        }

        return {
          status: 'done',
          nextStep: nextStepOf('discord_auth'),
          selectedRuntime: null,
          blockedReason: null,
          checkpoints: [],
          notes: [`Reused existing Discord bot token from ${detected.source}.`],
          logs: [
            makeLog(
              'discord_auth',
              'info',
              `Discord bot token already configured (source: ${detected.source}).`,
            ),
          ],
        };
      }

      throw new Error('Discord bot token is required');
    }

    if (token.length < 30 || !token.includes('.')) {
      throw new Error('Discord bot token looks invalid');
    }

    this.setKeychainSecret('DISCORD_BOT_TOKEN', token);

    const appId = typeof payload.discordAppId === 'string' ? payload.discordAppId.trim() : '';
    if (appId) {
      this.setKeychainSecret('DISCORD_APP_ID', appId);
    }

    return {
      status: 'done',
      nextStep: nextStepOf('discord_auth'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: ['Discord credentials stored in Keychain.'],
      logs: [makeLog('discord_auth', 'info', 'Discord token saved to Keychain.')],
    };
  }

  private async runAssistantName(payload: Record<string, unknown>): Promise<StepResult> {
    const dotenv = parseDotenv(this.repoRoot);
    const configured = this.detectValue(dotenv, 'ASSISTANT_NAME').value ?? 'Andy';

    const rawName =
      typeof payload.assistantName === 'string' && payload.assistantName.trim()
        ? payload.assistantName.trim()
        : configured;

    const assistantName = rawName
      .split('')
      .filter((char) => /[A-Za-z0-9_-]/.test(char))
      .join('');

    if (!assistantName) {
      throw new Error('Assistant name must contain letters or numbers');
    }

    this.setKeychainSecret('ASSISTANT_NAME', assistantName);

    for (const relPath of ['groups/main/CLAUDE.md', 'groups/CLAUDE.md']) {
      const fullPath = path.join(this.repoRoot, relPath);
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      const updated = content
        .replace(/# Andy/g, `# ${assistantName}`)
        .replace(/You are Andy/g, `You are ${assistantName}`)
        .replace(/@Andy/g, `@${assistantName}`);

      fs.writeFileSync(fullPath, updated, 'utf8');
    }

    return {
      status: 'done',
      nextStep: nextStepOf('assistant_name'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: [`Assistant name set to ${assistantName}.`],
      logs: [
        makeLog('assistant_name', 'info', `Assistant name updated to ${assistantName}.`),
      ],
    };
  }

  private async runSecurityConfirmation(payload: Record<string, unknown>): Promise<StepResult> {
    const confirmed = payload.confirmed === true;

    if (!confirmed) {
      return {
        status: 'blocked',
        nextStep: null,
        selectedRuntime: null,
        blockedReason:
          'You must acknowledge main-channel administrative privileges before proceeding.',
        checkpoints: [
          {
            id: 'confirm-main-channel-risk',
            title: 'Acknowledge security model',
            instructions: [
              'Main channel can manage all groups and tasks.',
              'Use a personal DM or private admin channel for main.',
            ],
            severity: 'warning',
            skippable: false,
            completed: false,
          },
        ],
        notes: [],
        logs: [
          makeLog('security_confirmation', 'warning', 'Security confirmation is required.'),
        ],
      };
    }

    return {
      status: 'done',
      nextStep: nextStepOf('security_confirmation'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: ['Security confirmation accepted.'],
      logs: [
        makeLog('security_confirmation', 'info', 'Main channel risk acknowledged.'),
      ],
    };
  }

  private async runRegisterMainChannel(
    payload: Record<string, unknown>,
  ): Promise<StepResult> {
    const hasExplicitInput = ['channelId', 'name', 'folder', 'trigger'].some((key) => {
      const value = payload[key];
      return typeof value === 'string' && value.trim().length > 0;
    });

    if (!hasExplicitInput) {
      const existingMain = this.detectRegisteredMainChannel();
      if (existingMain.configured) {
        return {
          status: 'done',
          nextStep: nextStepOf('register_main_channel'),
          selectedRuntime: null,
          blockedReason: null,
          checkpoints: [],
          notes: [
            `Main channel already registered (channelId=${existingMain.channelId ?? 'unknown'}).`,
          ],
          logs: [
            makeLog(
              'register_main_channel',
              'info',
              'Main channel already configured. Skipping registration.',
            ),
          ],
        };
      }
    }

    let channelId = typeof payload.channelId === 'string' ? payload.channelId.trim() : '';
    if (!channelId) {
      channelId = this.discoverLatestChannelId();
    }

    if (!channelId) {
      return {
        status: 'blocked',
        nextStep: null,
        selectedRuntime: null,
        blockedReason:
          'No channel ID available. Send any message to your bot, then retry this step.',
        checkpoints: [
          {
            id: 'send-discord-message',
            title: 'Generate channel metadata',
            instructions: [
              'Send a message in your target Discord DM or channel.',
              'Retry registration after the message appears.',
            ],
            severity: 'warning',
            skippable: false,
            completed: false,
          },
        ],
        notes: [],
        logs: [
          makeLog(
            'register_main_channel',
            'warning',
            'Could not auto-detect channel id from store/messages.db',
          ),
        ],
      };
    }

    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'main';
    const folder =
      typeof payload.folder === 'string' && payload.folder.trim() ? payload.folder.trim() : 'main';
    const trigger =
      typeof payload.trigger === 'string' && payload.trigger.trim()
        ? payload.trigger.trim()
        : '@Andy';

    if (!folder) {
      throw new Error('Main folder cannot be empty');
    }

    const targetPath = path.join(this.repoRoot, 'data/registered_groups.json');
    let groups: Record<string, unknown> = {};

    if (fs.existsSync(targetPath)) {
      try {
        groups = JSON.parse(fs.readFileSync(targetPath, 'utf8')) as Record<string, unknown>;
      } catch {
        groups = {};
      }
    }

    groups[channelId] = {
      name,
      folder,
      trigger,
      added_at: nowIso(),
    };

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${JSON.stringify(groups, null, 2)}\n`, 'utf8');
    fs.mkdirSync(path.join(this.repoRoot, `groups/${folder}/logs`), { recursive: true });

    return {
      status: 'done',
      nextStep: nextStepOf('register_main_channel'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: [`Registered main channel ${channelId}.`],
      logs: [
        makeLog(
          'register_main_channel',
          'info',
          `Registered channel ${channelId} with folder ${folder}.`,
        ),
      ],
    };
  }

  private discoverLatestChannelId(): string {
    const dbPath = path.join(this.repoRoot, 'store/messages.db');
    if (!fs.existsSync(dbPath)) {
      return '';
    }

    const script = `sqlite3 ${shellEscape(dbPath)} \"SELECT jid FROM chats WHERE jid != '__group_sync__' ORDER BY last_message_time DESC LIMIT 1;\"`;

    try {
      return this.runShellAndCaptureStdout(this.repoRoot, script, []);
    } catch {
      return '';
    }
  }

  private async runMountAllowlist(payload: Record<string, unknown>): Promise<StepResult> {
    const home = process.env.HOME;
    if (!home) {
      throw new Error('HOME is not set');
    }

    const allowlistPath = path.join(home, '.config/nanoclaw/mount-allowlist.json');

    const nonMainReadOnly = payload.nonMainReadOnly !== false;

    const allowedRoots: Array<{
      path: string;
      allowReadWrite: boolean;
      description: string;
    }> = [];

    if (Array.isArray(payload.allowedRoots)) {
      for (const root of payload.allowedRoots) {
        if (!root || typeof root !== 'object' || Array.isArray(root)) {
          continue;
        }

        const entry = root as Record<string, unknown>;
        const rootPath = typeof entry.path === 'string' ? entry.path.trim() : '';
        if (!rootPath) {
          continue;
        }

        allowedRoots.push({
          path: rootPath,
          allowReadWrite: entry.allowReadWrite === true,
          description: typeof entry.description === 'string' ? entry.description : '',
        });
      }
    }

    const content = {
      allowedRoots,
      blockedPatterns: [],
      nonMainReadOnly,
    };

    fs.mkdirSync(path.dirname(allowlistPath), { recursive: true });
    fs.writeFileSync(allowlistPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');

    return {
      status: 'done',
      nextStep: nextStepOf('mount_allowlist'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: [`Wrote mount allowlist to ${allowlistPath}`],
      logs: [
        makeLog('mount_allowlist', 'info', `Allowlist updated at ${allowlistPath}`),
      ],
    };
  }

  private async runLaunchdSetup(): Promise<StepResult> {
    const nodePath = this.runShellAndCaptureStdout(this.repoRoot, 'which node', []);
    const scriptPath = path.join(this.repoRoot, 'scripts/run-nanoclaw-from-keychain.sh');

    const scriptContent = `#!/bin/zsh
set -euo pipefail

PROJECT_ROOT=${shellEscape(this.repoRoot)}
NODE_PATH=${shellEscape(nodePath)}

CLAUDE_CODE_OAUTH_TOKEN=$(security find-generic-password -w -s ${KEYCHAIN_SERVICE} -a CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true)
ANTHROPIC_API_KEY=$(security find-generic-password -w -s ${KEYCHAIN_SERVICE} -a ANTHROPIC_API_KEY 2>/dev/null || true)
DISCORD_BOT_TOKEN=$(security find-generic-password -w -s ${KEYCHAIN_SERVICE} -a DISCORD_BOT_TOKEN 2>/dev/null || true)
DISCORD_APP_ID=$(security find-generic-password -w -s ${KEYCHAIN_SERVICE} -a DISCORD_APP_ID 2>/dev/null || true)
ASSISTANT_NAME=$(security find-generic-password -w -s ${KEYCHAIN_SERVICE} -a ASSISTANT_NAME 2>/dev/null || true)

if [ -z "$DISCORD_BOT_TOKEN" ]; then
  echo "Missing DISCORD_BOT_TOKEN in Keychain"
  exit 1
fi

if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Missing Claude credential in Keychain"
  exit 1
fi

if [ -z "$ASSISTANT_NAME" ]; then
  ASSISTANT_NAME="Andy"
fi

export CLAUDE_CODE_OAUTH_TOKEN
export ANTHROPIC_API_KEY
export DISCORD_BOT_TOKEN
export DISCORD_APP_ID
export ASSISTANT_NAME

cd "$PROJECT_ROOT"
exec "$NODE_PATH" "$PROJECT_ROOT/dist/index.js"
`;

    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');

    const chmodResult = spawnSync('chmod', ['+x', scriptPath], { stdio: 'ignore' });
    if (chmodResult.status !== 0) {
      throw new Error('Failed to chmod launch script');
    }

    const home = process.env.HOME;
    if (!home) {
      throw new Error('HOME is not set');
    }

    const plistPath = path.join(home, 'Library/LaunchAgents/com.nanoclaw.plist');

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>${scriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${this.repoRoot}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${home}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${home}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${this.repoRoot}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${this.repoRoot}/logs/nanoclaw.error.log</string>
</dict>
</plist>
`;

    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, plist, 'utf8');

    fs.mkdirSync(path.join(this.repoRoot, 'logs'), { recursive: true });

    const buildResult = await this.runShellScript(
      'launchd_setup',
      this.repoRoot,
      'npm run build',
      this.collectAuthEnv(),
    );
    if (buildResult.error) {
      throw new Error(buildResult.error);
    }

    const launchScript = `launchctl unload ${shellEscape(plistPath)} >/dev/null 2>&1 || true; launchctl load ${shellEscape(plistPath)}`;

    const launchResult = await this.runShellScript(
      'launchd_setup',
      this.repoRoot,
      launchScript,
      this.collectAuthEnv(),
    );

    const logs = [...buildResult.logs, ...launchResult.logs];

    if (launchResult.error) {
      throw new Error(launchResult.error);
    }

    return {
      status: 'done',
      nextStep: nextStepOf('launchd_setup'),
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: [
        `Launch script created at ${scriptPath}`,
        `launchd plist created at ${plistPath}`,
      ],
      logs,
    };
  }

  private async runFinalTest(
    stateSnapshot: SetupState,
    payload: Record<string, unknown>,
  ): Promise<StepResult> {
    const runtime = this.resolveWizardRuntime(stateSnapshot.selectedRuntime);
    const requireService = payload.requireService === true;

    const runtimeCheck =
      runtime === 'docker'
        ? 'docker info >/dev/null && echo RUNTIME_OK || echo RUNTIME_FAIL'
        : 'container system status >/dev/null && echo RUNTIME_OK || echo RUNTIME_FAIL';

    const script = requireService
      ? `launchctl list | grep -q com.nanoclaw && echo SERVICE_OK || echo SERVICE_FAIL; test -f data/registered_groups.json && echo GROUPS_OK || echo GROUPS_FAIL; ${runtimeCheck}`
      : `test -f data/registered_groups.json && echo GROUPS_OK || echo GROUPS_FAIL; ${runtimeCheck}`;

    const { logs, error } = await this.runShellScript(
      'final_test',
      this.repoRoot,
      script,
      this.collectAuthEnv(),
    );

    if (error) {
      throw new Error(error);
    }

    const hasService = requireService ? logHasMarker(logs, 'SERVICE_OK') : true;
    const hasGroups = logHasMarker(logs, 'GROUPS_OK');
    const hasRuntime = logHasMarker(logs, 'RUNTIME_OK');

    if (!(hasService && hasGroups && hasRuntime)) {
      if (requireService) {
        throw new Error(
          'Final test did not pass all checks (service/groups/runtime). Review log panel.',
        );
      }

      throw new Error(
        'Final test did not pass core checks (groups/runtime). Review log panel.',
      );
    }

    return {
      status: 'done',
      nextStep: null,
      selectedRuntime: null,
      blockedReason: null,
      checkpoints: [],
      notes: ['Setup completed successfully.'],
      logs,
    };
  }
}

export type {
  ManualActionEvent,
  SetupEventName,
  SetupLogEntry,
  SetupSnapshot,
  SetupState,
  SetupStepId,
  SkipManualCheckPayload,
  StartStepPayload,
  RetryStepPayload,
};
