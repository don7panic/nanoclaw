import {
  type SetupSnapshot,
  type SetupState,
  type SetupStepId,
} from '@/types';

export type RuntimeChoice = 'apple_container';
export type ClaudeAuthMethod = 'oauth' | 'api_key';

export interface AllowRootInput {
  id: string;
  path: string;
  allowReadWrite: boolean;
  description: string;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface StepDraft {
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
  requireServiceInFinalTest: boolean;
}

function getPayloadRecord(
  state: SetupState,
  stepId: SetupStepId,
): Record<string, unknown> | null {
  const payloads = state.stepPayloads;
  if (!payloads || typeof payloads !== 'object') {
    return null;
  }

  const payload = payloads[stepId];
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return null;
}

function getString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function getBoolean(
  record: Record<string, unknown> | null,
  key: string,
): boolean | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function parseAllowRoots(
  record: Record<string, unknown> | null,
): AllowRootInput[] | null {
  if (!record) return null;
  const value = record.allowedRoots;
  if (!Array.isArray(value)) return null;

  const roots = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const typed = entry as Record<string, unknown>;
      const path = typeof typed.path === 'string' ? typed.path : '';
      if (!path.trim()) return null;
      return {
        id: typeof typed.id === 'string' ? typed.id : generateId(),
        path,
        allowReadWrite:
          typeof typed.allowReadWrite === 'boolean' ? typed.allowReadWrite : false,
        description: typeof typed.description === 'string' ? typed.description : '',
      };
    })
    .filter((entry): entry is AllowRootInput => entry !== null);

  return roots.length > 0 ? roots : null;
}

export function createDefaultDraft(snapshot: SetupSnapshot): StepDraft {
  return {
    containerRuntime: 'apple_container',
    claudeAuthMethod:
      snapshot.claudeCredential.method === 'api_key' ? 'api_key' : 'oauth',
    claudeToken: '',
    discordBotToken: '',
    discordAppId: '',
    assistantName: snapshot.assistantName || 'Andy',
    securityConfirmed: false,
    mainChannelId: snapshot.registeredMainChannel.channelId || '',
    mainChannelName: snapshot.registeredMainChannel.name || 'main',
    mainChannelFolder: snapshot.registeredMainChannel.folder || 'main',
    mountNonMainReadOnly: true,
    mountRoots: [
      {
        id: generateId(),
        path: '~/projects',
        allowReadWrite: true,
        description: 'Development projects',
      },
    ],
    requireServiceInFinalTest: false,
  };
}

export function hydrateDraft(state: SetupState, snapshot: SetupSnapshot): StepDraft {
  const defaults = createDefaultDraft(snapshot);
  const containerPayload = getPayloadRecord(state, 'container_runtime');
  const claudePayload = getPayloadRecord(state, 'claude_auth');
  const discordPayload = getPayloadRecord(state, 'discord_auth');
  const assistantPayload = getPayloadRecord(state, 'assistant_name');
  const securityPayload = getPayloadRecord(state, 'security_confirmation');
  const mainPayload = getPayloadRecord(state, 'register_main_channel');
  const mountPayload = getPayloadRecord(state, 'mount_allowlist');
  const finalPayload = getPayloadRecord(state, 'final_test');
  const parsedRoots = parseAllowRoots(mountPayload);

  const claudeMethod = getString(claudePayload, 'method');
  const assistantName =
    getString(assistantPayload, 'assistantName') ||
    snapshot.assistantName ||
    defaults.assistantName;

  return {
    containerRuntime:
      getString(containerPayload, 'runtime') === 'apple_container'
        ? 'apple_container'
        : defaults.containerRuntime,
    claudeAuthMethod:
      claudeMethod === 'api_key' || claudeMethod === 'oauth'
        ? claudeMethod
        : defaults.claudeAuthMethod,
    claudeToken: '',
    discordBotToken: getString(discordPayload, 'discordBotToken') || defaults.discordBotToken,
    discordAppId: getString(discordPayload, 'discordAppId') || defaults.discordAppId,
    assistantName,
    securityConfirmed:
      getBoolean(securityPayload, 'confirmed') ?? defaults.securityConfirmed,
    mainChannelId:
      getString(mainPayload, 'channelId') ||
      snapshot.registeredMainChannel.channelId ||
      defaults.mainChannelId,
    mainChannelName:
      getString(mainPayload, 'name') ||
      snapshot.registeredMainChannel.name ||
      defaults.mainChannelName,
    mainChannelFolder:
      getString(mainPayload, 'folder') ||
      snapshot.registeredMainChannel.folder ||
      defaults.mainChannelFolder,
    mountNonMainReadOnly:
      getBoolean(mountPayload, 'nonMainReadOnly') ?? defaults.mountNonMainReadOnly,
    mountRoots: parsedRoots || defaults.mountRoots,
    requireServiceInFinalTest:
      getBoolean(finalPayload, 'requireService') ?? defaults.requireServiceInFinalTest,
  };
}

export function buildPayload(
  stepId: SetupStepId,
  draft: StepDraft,
): Record<string, unknown> {
  switch (stepId) {
    case 'container_runtime':
      return { runtime: 'apple_container' };
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
        trigger: `@${draft.assistantName || 'Andy'}`,
      };
    case 'mount_allowlist':
      return {
        nonMainReadOnly: draft.mountNonMainReadOnly,
        allowedRoots: draft.mountRoots,
      };
    case 'final_test':
      return {
        requireService: draft.requireServiceInFinalTest,
      };
    default:
      return {};
  }
}
