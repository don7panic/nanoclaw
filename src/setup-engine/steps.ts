import { SetupStepDefinition, SetupStepId } from './schema.js';

export const SETUP_STEPS: SetupStepDefinition[] = [
  {
    id: 'preflight',
    title: 'Preflight Checks',
    summary:
      'Validate host prerequisites: Node/npm/Claude CLI, writable repo, platform and network hints.',
    order: 0,
    skippable: false,
    next: 'install_dependencies',
  },
  {
    id: 'install_dependencies',
    title: 'Install Dependencies',
    summary: 'Run npm install and verify package integrity.',
    order: 1,
    skippable: false,
    next: 'container_runtime',
  },
  {
    id: 'container_runtime',
    title: 'Container Runtime',
    summary:
      'Detect Apple Container and Docker, select runtime, and validate daemon availability.',
    order: 2,
    skippable: false,
    next: 'claude_auth',
  },
  {
    id: 'claude_auth',
    title: 'Claude Authentication',
    summary:
      'Store Claude credential in Keychain and verify token format and retrieval.',
    order: 3,
    skippable: false,
    next: 'build_agent_image',
  },
  {
    id: 'build_agent_image',
    title: 'Build Agent Image',
    summary:
      'Build nanoclaw-agent image and run a smoke test in the selected runtime.',
    order: 4,
    skippable: false,
    next: 'discord_auth',
  },
  {
    id: 'discord_auth',
    title: 'Discord Authentication',
    summary:
      'Capture Discord bot credentials, store securely, and validate token shape.',
    order: 5,
    skippable: false,
    next: 'assistant_name',
  },
  {
    id: 'assistant_name',
    title: 'Assistant Identity',
    summary:
      'Set assistant trigger name and keep group memory defaults aligned.',
    order: 6,
    skippable: false,
    next: 'security_confirmation',
  },
  {
    id: 'security_confirmation',
    title: 'Main Channel Security',
    summary:
      'Explicitly confirm elevated permissions and acknowledge main-channel risk.',
    order: 7,
    skippable: false,
    next: 'register_main_channel',
  },
  {
    id: 'register_main_channel',
    title: 'Register Main Channel',
    summary:
      'Capture the most recent Discord channel and write data/registered_groups.json.',
    order: 8,
    skippable: false,
    next: 'mount_allowlist',
  },
  {
    id: 'mount_allowlist',
    title: 'External Access Allowlist',
    summary:
      'Create ~/.config/nanoclaw/mount-allowlist.json with least-privilege defaults.',
    order: 9,
    skippable: false,
    next: 'launchd_setup',
  },
  {
    id: 'launchd_setup',
    title: 'Background Service',
    summary:
      'Render launchd plist and bootstrap NanoClaw as a user service on macOS.',
    order: 10,
    skippable: false,
    next: 'final_test',
  },
  {
    id: 'final_test',
    title: 'Final Verification',
    summary:
      'Run runtime checks, validate service status, and generate a setup report.',
    order: 11,
    skippable: false,
  },
];

export const STEP_IDS = SETUP_STEPS.map((step) => step.id);

export const FIRST_STEP_ID: SetupStepId = 'preflight';

export function getStepById(stepId: SetupStepId): SetupStepDefinition {
  const step = SETUP_STEPS.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new Error(`Unknown setup step: ${stepId}`);
  }
  return step;
}
