# NanoClaw Desktop Setup Wizard

## Overview

Desktop onboarding is now split into two phases:

1. **Setup Wizard (blocking)**: dependency installation and runtime readiness only
2. **Main Dashboard (non-blocking)**: integrations and optional configuration

- App location: `apps/desktop`
- Stack: `Web (Vite + React + TypeScript) + Node setup service`
- UI stack: `Tailwind CSS + shadcn-style component primitives`
- Runtime path in setup: Apple Container (desktop-guided path)

## Setup Scope (Blocking)

The setup wizard uses a horizontal stepper with 4 dependency-only steps:

1. `preflight`
2. `install_dependencies`
3. `container_runtime`
4. `build_agent_image`

Setup completion is based on dependency readiness. Already passing checks are auto-skipped.

## Dependency Matrix

The setup matrix checks:

- Node.js
- npm
- Claude CLI
- repository write permission
- workspace npm dependencies (`workspaceDepsReady`)
- Apple Container binary
- Apple Container system status
- `nanoclaw-agent` image availability

Snapshot fields `canRunCore` and `missingCoreItems` represent this dependency matrix only.

## Main Dashboard Scope (Non-Blocking)

After setup passes, app navigates to the dashboard and surfaces task cards:

1. Claude credential
2. Discord bot token
3. Register main channel
4. Mount project allowlist
5. Assistant name
6. launchd background service

These tasks do not block setup completion.

## Status Feedback

Dependency indicators use breathing-dot style states:

- `checking`
- `running`
- `missing`
- `ready`
- `error`

## Desktop API Contract

HTTP endpoints in use:

- `GET /api/setup/state`
- `GET /api/setup/snapshot`
- `POST /api/setup/start-step`
- `POST /api/setup/retry-step`
- `POST /api/setup/skip-manual-check`
- `POST /api/setup/cancel`

Events:

- `setup://log`
- `setup://step-status`
- `setup://requires-user-action`
- `setup://fatal-error`

## Data and Compatibility

State/report paths unchanged:

- `data/setup-wizard/state.json`
- `data/setup-wizard/report.json`

Legacy step functions remain available and reusable from dashboard task cards.

## Running

From repo root:

```bash
npm run desktop:install
npm run desktop:dev
```

## Troubleshooting

- If setup is blocked, resolve the dependency checkpoint and retry the same step.
- If dashboard task fails, only that task needs retry; setup state remains complete.
- If a runtime check fails, inspect `data/setup-wizard/report.json`.
