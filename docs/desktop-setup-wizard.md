# NanoClaw Desktop Setup Wizard

## Overview

The Desktop Setup Wizard replaces command-style `/setup` as the primary onboarding path.

- App location: `apps/desktop`
- Stack: `Tauri 2 + React + TypeScript + Vite`
- UX goal: complete setup without terminal literacy
- Platform focus: macOS-first
- Runtime support: Apple Container and Docker

## Data and Compatibility

The wizard preserves existing NanoClaw runtime artifacts:

- `data/registered_groups.json`
- `store/messages.db`
- `groups/*`
- `launchd/com.nanoclaw.plist` (template remains, generated plist is written to `~/Library/LaunchAgents`)

State and reports are persisted to:

- `data/setup-wizard/state.json`
- `data/setup-wizard/report.json`

## Step Model

The wizard is state-machine driven and deterministic:

1. `preflight`
2. `install_dependencies`
3. `container_runtime`
4. `claude_auth`
5. `build_agent_image`
6. `discord_auth`
7. `assistant_name`
8. `security_confirmation`
9. `register_main_channel`
10. `mount_allowlist`
11. `launchd_setup`
12. `final_test`

Each step supports:

- `running`, `blocked`, `failed`, `done` statuses
- manual checkpoints for user actions outside the app
- retry from persisted state

## Desktop API Contract

Tauri commands:

- `setup_start_step` (frontend wrapper: `setup.startStep(payload)`)
- `setup_retry_step` (frontend wrapper: `setup.retryStep(stepId)`)
- `setup_skip_manual_check` (frontend wrapper: `setup.skipManualCheck(stepId, checkpointId)`)
- `setup_get_state` (frontend wrapper: `setup.getState()`)
- `setup_cancel` (frontend wrapper: `setup.cancel()`)

Tauri event channels:

- `setup://log`
- `setup://step-status`
- `setup://requires-user-action`
- `setup://fatal-error`

## Security Model

Secrets are stored in macOS Keychain (`service = nanoclaw.setup`):

- `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
- `DISCORD_BOT_TOKEN`
- optional `DISCORD_APP_ID`
- `ASSISTANT_NAME`

`.env` is no longer required for setup persistence. Runtime auth is injected via launch script from Keychain values.

Mount allowlist remains external and tamper-resistant:

- `~/.config/nanoclaw/mount-allowlist.json`

## Runtime Injection Change

`src/container-runner.ts` now resolves auth env in this order:

1. `process.env` (for Keychain-injected launchd runtime)
2. `.env` fallback (for local/dev compatibility)

This enables keychain-first setup without breaking existing development workflows.

## Running the Wizard

From repo root:

```bash
npm run desktop:install
npm run desktop:dev
```

## Troubleshooting

- If a step is blocked, complete the shown manual checklist and retry.
- If launchd setup fails, check `~/Library/LaunchAgents/com.nanoclaw.plist` and `logs/nanoclaw.error.log`.
- If final test fails, inspect `data/setup-wizard/report.json` for per-step status.
