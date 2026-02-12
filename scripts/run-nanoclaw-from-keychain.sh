#!/bin/zsh
set -euo pipefail

PROJECT_ROOT='/Users/oasis/workspace/nanoclaw'
NODE_PATH='/usr/local/bin/node'

CLAUDE_CODE_OAUTH_TOKEN=$(security find-generic-password -w -s nanoclaw.setup -a CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true)
ANTHROPIC_API_KEY=$(security find-generic-password -w -s nanoclaw.setup -a ANTHROPIC_API_KEY 2>/dev/null || true)
DISCORD_BOT_TOKEN=$(security find-generic-password -w -s nanoclaw.setup -a DISCORD_BOT_TOKEN 2>/dev/null || true)
DISCORD_APP_ID=$(security find-generic-password -w -s nanoclaw.setup -a DISCORD_APP_ID 2>/dev/null || true)
ASSISTANT_NAME=$(security find-generic-password -w -s nanoclaw.setup -a ASSISTANT_NAME 2>/dev/null || true)

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
