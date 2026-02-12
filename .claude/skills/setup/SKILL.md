---
name: setup
description: Compatibility shim. Redirects users to the NanoClaw Desktop Setup Wizard as the primary onboarding path.
---

# NanoClaw Setup (Redirect)

NanoClaw now uses the **Desktop Setup Wizard** as the primary onboarding flow.

## Primary Path

1. Open `/workspace/project/apps/desktop`
2. Install dependencies: `npm install`
3. Run the desktop wizard: `npm run tauri:dev`
4. Complete all 12 guided steps in the app

The desktop flow now handles:
- Runtime checks and dependency installation
- Keychain-first secret storage
- Discord/Claude authentication
- Main channel registration
- Mount allowlist generation
- launchd service provisioning and final verification

## Legacy Note

The old command-style `/setup` flow is deprecated and kept only as a compatibility reference.
Use the desktop wizard for all new setups.
